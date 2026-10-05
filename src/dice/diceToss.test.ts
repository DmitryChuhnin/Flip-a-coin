import { beforeAll, describe, expect, it } from 'vitest';
import { fromAxisAngle, fromTo, multiply, rotate, type Pose, type Quat } from '../math/quat';
import { FRAME_STRIDE, frameCount, framePose, STEP_S } from '../physics/frames';
import { initPhysics, simulateToss, type Simulation, type TossInput } from '../physics/simulate';
import { seededSource } from '../testing/seededSource';
import { wallOvershoot, wallStarts } from '../testing/wallStarts';
import { hullVectors } from '../toss/body';
import { upFace } from '../toss/faces';
import {
  anchorTrajectory,
  MAX_ATTEMPTS,
  MAX_REST_TILT_DEG,
  planToss,
  precomputeFallback,
  type TossPlan,
  type Trajectory,
} from '../toss/planToss';
import { createDie, DIE_KINDS, SETTLE_WITHIN_S, type DieKind } from './dieSpec';

const dice = Object.fromEntries(DIE_KINDS.map((kind) => [kind, createDie(kind)]));
const fallbacks: Partial<Record<DieKind, { normal: Trajectory; reduced: Trajectory }>> = {};

beforeAll(async () => {
  await initPhysics();
  for (const kind of DIE_KINDS) {
    const { body } = dice[kind]!;
    fallbacks[kind] = {
      normal: precomputeFallback(body, simulateToss, false),
      reduced: precomputeFallback(body, simulateToss, true),
    };
  }
});

const dot4 = (a: Quat, b: Quat) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

function lastPose(frames: Float32Array): Pose {
  return framePose(frames, frameCount(frames) - 1);
}

/** Pose the player sees at rest: the body pose turned by the visual offset. */
function shownRest(plan: TossPlan<string>): Pose {
  const last = lastPose(plan.frames);
  return { position: last.position, quaternion: multiply(last.quaternion, plan.visualOffset) };
}

const neverSettles = (input: TossInput): Simulation => ({ ...simulateToss(input), settled: false });

describe.each(DIE_KINDS)('%s toss', (kind) => {
  const { body, sides } = dice[kind]!;
  const plan = (overrides: Partial<Parameters<typeof planToss<string>>[0]> = {}) =>
    planToss<string>({
      body,
      start: body.initialPose,
      reducedMotion: false,
      fallback: (reducedMotion) => fallbacks[kind]![reducedMotion ? 'reduced' : 'normal'],
      simulate: simulateToss,
      ...overrides,
    });

  it('shows the chosen outcome flat on top for every one of 200 consecutive plans', () => {
    const source = seededSource(sides * 101);
    const seen = new Set<string>();
    let start = body.initialPose;
    for (let i = 0; i < 200; i += 1) {
      const result = plan({ start, source });
      start = shownRest(result);
      const up = upFace(start.quaternion, body.faces);
      expect(body.faces[up.index]!.value).toBe(result.outcome);
      expect(up.tiltDeg).toBeLessThanOrEqual(MAX_REST_TILT_DEG);
      expect(result.profile).toBe('tumble');
      expect(result.durationS).toBeLessThanOrEqual(SETTLE_WITHIN_S);
      seen.add(result.outcome);
    }
    expect(seen.size).toBe(sides);
  });

  it('simulates every roll for at most 3.5 s with damping after landing, fallbacks included', () => {
    const inputs: TossInput[] = [];
    const recording = (input: TossInput): Simulation => {
      inputs.push(input);
      return simulateToss(input);
    };
    const source = seededSource(sides * 7);
    const plans = [false, true].flatMap((reducedMotion) =>
      Array.from({ length: 10 }, () => plan({ reducedMotion, simulate: recording, source })),
    );
    expect(inputs.length).toBeGreaterThanOrEqual(20);
    for (const result of plans) expect(result.durationS).toBeLessThanOrEqual(SETTLE_WITHIN_S);
    for (const reducedMotion of [false, true]) precomputeFallback(body, recording, reducedMotion);
    for (const input of inputs) {
      expect(input.landedDamping).toBeDefined();
      expect(input.maxSimulatedS).toBe(SETTLE_WITHIN_S);
    }
    for (const fallback of Object.values(fallbacks[kind]!)) {
      expect(frameCount(fallback.frames) - 1).toBeLessThanOrEqual(SETTLE_WITHIN_S / STEP_S);
    }
  });

  it('rejects a die resting on an edge and still shows the chosen outcome', () => {
    const tilted = (input: TossInput): Simulation => {
      const sim = simulateToss(input);
      const frames = sim.frames.slice();
      const leaning = multiply(
        fromAxisAngle([0, 0, 1], (25 * Math.PI) / 180),
        fromTo(body.faces[0]!.normal, [0, 1, 0]),
      );
      frames.set(leaning, (frameCount(frames) - 1) * FRAME_STRIDE + 3);
      return { ...sim, frames };
    };
    const source = seededSource(7);
    for (let i = 0; i < 5; i += 1) {
      const result = plan({ simulate: tilted, source });
      expect(result.usedFallback).toBe(true);
      const up = upFace(shownRest(result).quaternion, body.faces);
      expect(body.faces[up.index]!.value).toBe(result.outcome);
    }
  });

  it('falls back after three unsettled attempts and shows every outcome flat', () => {
    const source = seededSource(11);
    const seen = new Set<string>();
    for (let i = 0; i < 6 * sides; i += 1) {
      const result = plan({ simulate: neverSettles, source });
      expect(result.usedFallback).toBe(true);
      expect(result.attempts).toBe(MAX_ATTEMPTS);
      const up = upFace(shownRest(result).quaternion, body.faces);
      expect(body.faces[up.index]!.value).toBe(result.outcome);
      expect(up.tiltDeg).toBeLessThanOrEqual(MAX_REST_TILT_DEG);
      seen.add(result.outcome);
    }
    expect(seen.size).toBe(sides);
  });

  it('anchors the fallback at a start resting on any face, keeping the rest flat', () => {
    const fallback = fallbacks[kind]!.normal;
    const recordedRest = lastPose(fallback.frames);
    for (let face = 0; face < sides; face += 1) {
      const quaternion = multiply(
        fromAxisAngle([0, 1, 0], 0.9 * face),
        fromTo(body.faces[face]!.normal, [0, 1, 0]),
      );
      const start: Pose = { position: [1, body.initialPose.position[1], -1.5], quaternion };
      const anchored = anchorTrajectory(fallback, start, body);
      const first = framePose(anchored.frames, 0);
      for (let k = 0; k < 3; k += 1) expect(first.position[k]).toBeCloseTo(start.position[k]!, 5);
      for (let k = 0; k < 4; k += 1) {
        expect(
          first.quaternion[k]! * Math.sign(first.quaternion[3] * quaternion[3] || 1),
        ).toBeCloseTo(quaternion[k]!, 5);
      }
      const rest = lastPose(anchored.frames);
      expect(upFace(rest.quaternion, body.faces).tiltDeg).toBeLessThan(1);
      expect(rest.position[1]).toBeCloseTo(recordedRest.position[1], 4);
    }
  });

  it('lands both anchored fallbacks flat and inside the walls from a start leaning on a wall', () => {
    for (const fallback of Object.values(fallbacks[kind]!)) {
      const landing = fallback.contacts[0]!.frame;
      for (const start of wallStarts(body)) {
        const anchored = anchorTrajectory(fallback, start, body);
        const first = framePose(anchored.frames, 0);
        for (let k = 0; k < 3; k += 1) expect(first.position[k]).toBeCloseTo(start.position[k]!, 5);
        expect(Math.abs(dot4(first.quaternion, start.quaternion))).toBeCloseTo(1, 9);
        expect(wallOvershoot(anchored.frames, body, landing)).toBeLessThanOrEqual(1e-6);
        const rest = lastPose(anchored.frames);
        expect(upFace(rest.quaternion, body.faces).tiltDeg).toBeLessThan(1);
        const bottom = Math.min(
          ...hullVectors(body.hull).map((p) => rotate(rest.quaternion, p)[1]),
        );
        expect(rest.position[1] + bottom).toBeGreaterThan(-1e-3);
      }
    }
  });

  it('flies lower and shorter under reduced motion', () => {
    const apex = (p: TossPlan<string>) =>
      Math.max(
        ...Array.from(
          { length: frameCount(p.frames) },
          (_, i) => framePose(p.frames, i).position[1],
        ),
      );
    const source = seededSource(31);
    const reduced = [
      ...Array.from({ length: 20 }, () => plan({ reducedMotion: true, source })),
      ...Array.from({ length: 5 }, () =>
        plan({ reducedMotion: true, simulate: neverSettles, source }),
      ),
    ];
    const normal = Array.from({ length: 20 }, () => plan({ source }));
    expect(reduced.every((p) => p.profile === 'reduced')).toBe(true);
    expect(reduced.filter((p) => !p.usedFallback).length).toBeGreaterThanOrEqual(15);
    expect(reduced.filter((p) => p.usedFallback).length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...reduced.map(apex))).toBeLessThan(Math.min(...normal.map(apex)));
    const { reduced: profile, reducedFallback: spec } = body.launch;
    expect(spec.lift).toBeLessThanOrEqual(profile.lift[1]);
  });
});
