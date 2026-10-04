import { beforeAll, describe, expect, it } from 'vitest';
import { fromAxisAngle, fromTo, multiply, type Pose } from '../math/quat';
import { FRAME_STRIDE, frameCount, framePose } from '../physics/frames';
import { initPhysics, simulateToss, type Simulation, type TossInput } from '../physics/simulate';
import { seededSource } from '../testing/seededSource';
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
import { createDie, DIE_KINDS, type DieKind } from './dieSpec';

const dice = Object.fromEntries(DIE_KINDS.map((kind) => [kind, createDie(kind)]));
const fallbacks: Partial<Record<DieKind, Trajectory>> = {};

beforeAll(async () => {
  await initPhysics();
  for (const kind of DIE_KINDS)
    fallbacks[kind] = precomputeFallback(dice[kind]!.body, simulateToss);
});

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
      fallback: fallbacks[kind]!,
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
      seen.add(result.outcome);
    }
    expect(seen.size).toBe(sides);
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
    const fallback = fallbacks[kind]!;
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

  it('flies lower and shorter under reduced motion', () => {
    const apex = (p: TossPlan<string>) =>
      Math.max(
        ...Array.from(
          { length: frameCount(p.frames) },
          (_, i) => framePose(p.frames, i).position[1],
        ),
      );
    const source = seededSource(31);
    const reduced = Array.from({ length: 20 }, () => plan({ reducedMotion: true, source }));
    const normal = Array.from({ length: 20 }, () => plan({ source }));
    expect(reduced.every((p) => p.profile === 'reduced' || p.usedFallback)).toBe(true);
    const flown = reduced.filter((p) => !p.usedFallback);
    expect(Math.max(...flown.map(apex))).toBeLessThan(Math.min(...normal.map(apex)));
  });
});
