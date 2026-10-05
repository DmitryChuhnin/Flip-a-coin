import { add, scale, sub } from '../math/polyhedron';
import {
  conjugate,
  IDENTITY,
  multiply,
  rotate,
  slerp,
  type Pose,
  type Quat,
  type Vec3,
} from '../math/quat';
import {
  durationS,
  FRAME_STRIDE,
  frameCount,
  framePose,
  GRAVITY,
  STEP_S,
  WALL_INNER,
} from '../physics/frames';
import type { Contact, Simulation, TossInput } from '../physics/simulate';
import { pickWeighted, randomInt, randomUnit, type Uint32Source } from '../random';
import { bodyReach, type TossBody } from './body';
import { remapRotation, upFace } from './faces';
import { sampleImpulse, type Impulse, type ProfileName } from './profiles';

export const MAX_ATTEMPTS = 3;
/** A rest pose tilted more than this (a coin on its edge, a die on an edge or a wall) is no result. */
export const MAX_REST_TILT_DEG = 10;
/** Shortest stretch of flight the visual remap may be spread over. */
export const MIN_BLEND_S = 0.2;

export interface BlendWindow {
  startS: number;
  endS: number;
}

export interface TossPlan<V extends string> {
  outcome: V;
  frames: Float32Array;
  contacts: Contact[];
  /** Shown orientation is body · visualOffset once the blend window has passed. */
  visualOffset: Quat;
  /** Flight stretch where the visual offset is eased in, high enough to clear the table. */
  blend: BlendWindow;
  durationS: number;
  profile: ProfileName;
  attempts: number;
  usedFallback: boolean;
}

export interface Trajectory {
  frames: Float32Array;
  contacts: Contact[];
}

export interface PlanOptions<V extends string> {
  body: TossBody<V>;
  /** Where the shown body lies now. */
  start: Pose;
  reducedMotion: boolean;
  /** Valid trajectory used when every attempt is rejected. */
  fallback: Trajectory;
  simulate: (input: TossInput) => Simulation;
  source?: Uint32Source;
}

function lastPose(frames: Float32Array): Pose {
  return framePose(frames, frameCount(frames) - 1);
}

function isFlatRest<V extends string>(sim: Simulation, body: TossBody<V>): boolean {
  return (
    sim.settled && upFace(lastPose(sim.frames).quaternion, body.faces).tiltDeg <= MAX_REST_TILT_DEG
  );
}

/** First continuous stretch with the body center above `clearance`. */
export function findBlendWindow(frames: Float32Array, clearance: number): BlendWindow | null {
  const count = frameCount(frames);
  let first = -1;
  for (let i = 0; i < count; i += 1) {
    const high = frames[i * FRAME_STRIDE + 1]! > clearance;
    if (high && first < 0) first = i;
    if (!high && first >= 0) return { startS: first * STEP_S, endS: (i - 1) * STEP_S };
  }
  return first >= 0 ? { startS: first * STEP_S, endS: (count - 1) * STEP_S } : null;
}

function isLongEnough(window: BlendWindow | null): window is BlendWindow {
  return window !== null && window.endS - window.startS >= MIN_BLEND_S;
}

/** Spin axis in the body frame halfway through the window, from two neighbouring frames. */
function localSpinAxis(frames: Float32Array, window: BlendWindow): Vec3 {
  const last = frameCount(frames) - 2;
  const i = Math.min(last, Math.round((window.startS + window.endS) / 2 / STEP_S));
  const delta = multiply(
    conjugate(framePose(frames, i).quaternion),
    framePose(frames, i + 1).quaternion,
  );
  const sign = delta[3] < 0 ? -1 : 1;
  return [delta[0] * sign, delta[1] * sign, delta[2] * sign];
}

function finish<V extends string>(
  trajectory: Trajectory,
  desired: number,
  body: TossBody<V>,
): Pick<TossPlan<V>, 'visualOffset' | 'blend'> | null {
  const { frames } = trajectory;
  const landed = upFace(lastPose(frames).quaternion, body.faces).index;
  const window = findBlendWindow(frames, body.clearance);
  const longEnough = isLongEnough(window);
  const preferAxis = longEnough ? localSpinAxis(frames, window) : undefined;
  const visualOffset = remapRotation(body.remaps, landed, desired, preferAxis);
  const isIdentity = Math.abs(visualOffset[3]) > 1 - 1e-9;
  if (!isIdentity && !longEnough) return null;
  return { visualOffset, blend: longEnough ? window : { startS: 0, endS: 0 } };
}

/** Rotation about world +Y closest to `q` (the twist part of a swing-twist split). */
function yawOf(q: Quat): Quat {
  const length = Math.hypot(q[1], q[3]);
  return length < 1e-9 ? [0, 0, 0, 1] : [0, q[1] / length, 0, q[3] / length];
}

/** Sideways shift that keeps the given center positions `reach` away from the side walls. */
function wallShift(positions: Vec3[], reach: number, inset: number): Vec3 {
  const fit = (axis: 0 | 2, wall: number): number => {
    const limit = wall - inset - reach;
    const low = Math.min(...positions.map((p) => p[axis]));
    const high = Math.max(...positions.map((p) => p[axis]));
    if (high - low > 2 * limit) return -(high + low) / 2;
    return Math.min(Math.max(0, -limit - low), limit - high);
  };
  return [fit(0, WALL_INNER.x), 0, fit(2, WALL_INNER.z)];
}

/**
 * Re-anchors a trajectory that started at rest elsewhere so it starts at `start`. The body frame
 * is relabelled by a symmetry S that takes the start's up face to the recorded one, and the flight
 * is turned about the vertical. Until the first landing the start's tilt is eased out and the body
 * drifts sideways just enough to keep the roll after landing inside the walls.
 */
export function anchorTrajectory<V extends string>(
  trajectory: Trajectory,
  start: Pose,
  body: TossBody<V>,
): Trajectory {
  const origin = framePose(trajectory.frames, 0);
  const recordedUp = upFace(origin.quaternion, body.faces).index;
  const startUp = upFace(start.quaternion, body.faces).index;
  const relabel = body.remaps[recordedUp]![startUp]![0]!;
  // turn · origin · relabel = start exactly; turn = tilt · yaw, tilt is the start's own small lean.
  const turn = multiply(
    start.quaternion,
    multiply(conjugate(relabel), conjugate(origin.quaternion)),
  );
  const yaw = yawOf(turn);
  const tilt = multiply(turn, conjugate(yaw));

  const count = frameCount(trajectory.frames);
  const landing = Math.max(1, Math.min(count - 1, trajectory.contacts[0]?.frame ?? count - 1));
  const centers = Array.from({ length: count }, (_, i) => {
    const offset = rotate(yaw, sub(framePose(trajectory.frames, i).position, origin.position));
    return add(start.position, offset);
  });
  const reach = bodyReach(body.hull);
  const shift = wallShift(centers.slice(landing), reach, body.launch.wallInset);

  const frames = new Float32Array(trajectory.frames.length);
  centers.forEach((center, i) => {
    const s = Math.min(1, i / landing);
    const q = multiply(
      slerp(tilt, IDENTITY, s),
      multiply(yaw, multiply(framePose(trajectory.frames, i).quaternion, relabel)),
    );
    frames.set([...add(center, scale(shift, s)), ...q], i * FRAME_STRIDE);
  });
  return { frames, contacts: trajectory.contacts };
}

export function planToss<V extends string>(options: PlanOptions<V>): TossPlan<V> {
  const { body, start, reducedMotion, simulate, source } = options;
  const desired = randomInt(body.faces.length, source);
  const outcome = body.faces[desired]!.value;
  const unit = () => randomUnit(source);
  const { launch } = body;
  const weights = launch.profiles.map((profile) => profile.weight);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const profile = reducedMotion
      ? launch.reduced
      : launch.profiles[pickWeighted(weights, source)]!;
    const impulse = sampleImpulse(profile, start, unit, launch.touchdown);
    const sim = simulate(tossInput(body, start, impulse));
    if (!isFlatRest(sim, body)) continue;
    const remap = finish(sim, desired, body);
    if (!remap) continue;
    return {
      outcome,
      frames: sim.frames,
      contacts: sim.contacts,
      ...remap,
      durationS: durationS(sim.frames),
      profile: profile.name,
      attempts: attempt,
      usedFallback: false,
    };
  }

  const anchored = anchorTrajectory(options.fallback, start, body);
  const remap = finish(anchored, desired, body);
  if (!remap) throw new Error('Fallback trajectory has no blend window');
  return {
    outcome,
    frames: anchored.frames,
    contacts: anchored.contacts,
    ...remap,
    durationS: durationS(anchored.frames),
    profile: launch.profiles[0]!.name,
    attempts: MAX_ATTEMPTS,
    usedFallback: true,
  };
}

function tossInput<V extends string>(body: TossBody<V>, start: Pose, impulse: Impulse): TossInput {
  return {
    hull: body.hull,
    density: body.density,
    start,
    ...impulse,
    wallInset: body.launch.wallInset,
  };
}

/** Fixed straight-up toss from the body's initial pose, tried with a few spin rates until one rests flat. */
export function precomputeFallback<V extends string>(
  body: TossBody<V>,
  simulate: (input: TossInput) => Simulation,
): Trajectory {
  const { lift, halfTurns: rates } = body.launch.fallback;
  for (const halfTurns of rates) {
    const flightS = (2 * lift) / GRAVITY;
    const sim = simulate(
      tossInput(body, body.initialPose, {
        linearVelocity: [0, lift, 0],
        angularVelocity: [(halfTurns * Math.PI) / flightS, 0, 0],
        angularDamping: 0.3,
      }),
    );
    if (isFlatRest(sim, body) && isLongEnough(findBlendWindow(sim.frames, body.clearance))) {
      return { frames: sim.frames, contacts: sim.contacts };
    }
  }
  throw new Error('No fallback toss came to rest flat');
}
