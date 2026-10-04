import { conjugate, multiply, type Pose, type Quat, type Vec3 } from '../math/quat';
import { durationS, FRAME_STRIDE, frameCount, framePose, STEP_S } from '../physics/frames';
import { GRAVITY, type Contact, type Simulation, type TossInput } from '../physics/simulate';
import { pickWeighted, randomInt, randomUnit, type Uint32Source } from '../random';
import { remapRotation, upFace, type Face } from './faces';
import {
  PROFILES,
  REDUCED_MOTION_PROFILE,
  sampleImpulse,
  type Impulse,
  type ProfileName,
} from './profiles';

export const MAX_ATTEMPTS = 3;
const PROFILE_WEIGHTS = PROFILES.map((profile) => profile.weight);
/** A rest pose tilted more than this is the coin leaning on its edge, not a result. */
export const MAX_REST_TILT_DEG = 10;
/** Shortest stretch of flight the visual remap may be spread over. */
export const MIN_BLEND_S = 0.2;

export interface TossBody<V extends string> {
  hull: Float32Array;
  density: number;
  faces: readonly Face<V>[];
  /** Rotations mapping the hull onto itself, in the local frame. */
  symmetries: readonly Quat[];
  /** Body center height above which no orientation touches the table. */
  clearance: number;
}

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
  const visualOffset = remapRotation(landed, desired, body.faces, body.symmetries, preferAxis);
  const isIdentity = Math.abs(visualOffset[3]) > 1 - 1e-9;
  if (!isIdentity && !longEnough) return null;
  return { visualOffset, blend: longEnough ? window : { startS: 0, endS: 0 } };
}

/**
 * Re-anchors a trajectory that started at rest elsewhere so it starts at `start`: shifts it on
 * the table and relabels the body frame. Both rest poses are flat, so the relabelling only turns
 * the outline within its own plane and keeps the flat rest height.
 */
export function anchorTrajectory(trajectory: Trajectory, start: Pose): Trajectory {
  const origin = framePose(trajectory.frames, 0);
  const relabel = multiply(conjugate(origin.quaternion), start.quaternion);
  const frames = new Float32Array(trajectory.frames.length);
  for (let i = 0; i < frameCount(frames); i += 1) {
    const pose = framePose(trajectory.frames, i);
    const q = multiply(pose.quaternion, relabel);
    frames.set(
      [
        pose.position[0] - origin.position[0] + start.position[0],
        pose.position[1] - origin.position[1] + start.position[1],
        pose.position[2] - origin.position[2] + start.position[2],
        ...q,
      ],
      i * FRAME_STRIDE,
    );
  }
  return { frames, contacts: trajectory.contacts };
}

export function planToss<V extends string>(options: PlanOptions<V>): TossPlan<V> {
  const { body, start, reducedMotion, simulate, source } = options;
  const desired = randomInt(body.faces.length, source);
  const outcome = body.faces[desired]!.value;
  const unit = () => randomUnit(source);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const profile = reducedMotion
      ? REDUCED_MOTION_PROFILE
      : PROFILES[pickWeighted(PROFILE_WEIGHTS, source)]!;
    const impulse = sampleImpulse(profile, start, unit);
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

  const anchored = anchorTrajectory(options.fallback, start);
  const remap = finish(anchored, desired, body);
  if (!remap) throw new Error('Fallback trajectory has no blend window');
  return {
    outcome,
    frames: anchored.frames,
    contacts: anchored.contacts,
    ...remap,
    durationS: durationS(anchored.frames),
    profile: 'normal',
    attempts: MAX_ATTEMPTS,
    usedFallback: true,
  };
}

function tossInput<V extends string>(body: TossBody<V>, start: Pose, impulse: Impulse): TossInput {
  return { hull: body.hull, density: body.density, start, ...impulse };
}

/** Fixed straight-up toss, tried with a few spin rates until one rests flat. */
export function precomputeFallback<V extends string>(
  body: TossBody<V>,
  start: Pose,
  simulate: (input: TossInput) => Simulation,
): Trajectory {
  const lift = 10.5;
  for (const halfTurns of [7, 6, 8, 5, 9]) {
    const flightS = (2 * lift) / GRAVITY;
    const sim = simulate(
      tossInput(body, start, {
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
