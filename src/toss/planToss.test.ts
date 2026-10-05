import { beforeAll, describe, expect, it, vi } from 'vitest';
import { COIN_BODY, INITIAL_POSE, type CoinValue } from '../coin/coinSpec';
import { fromAxisAngle, IDENTITY, multiply, type Pose } from '../math/quat';
import { durationS, frameCount, framePose } from '../physics/frames';
import { initPhysics, simulateToss, type Simulation, type TossInput } from '../physics/simulate';
import { seededSource } from '../testing/seededSource';
import { wallOvershoot, wallStarts } from '../testing/wallStarts';
import { upFace } from './faces';
import {
  anchorTrajectory,
  findBlendWindow,
  MAX_ATTEMPTS,
  MAX_REST_TILT_DEG,
  planToss,
  precomputeFallback,
  type TossPlan,
  type Trajectory,
} from './planToss';
import { COIN_PROFILES } from './profiles';

let fallback: Trajectory;
let reducedFallback: Trajectory;

beforeAll(async () => {
  await initPhysics();
  fallback = precomputeFallback(COIN_BODY, simulateToss, false);
  reducedFallback = precomputeFallback(COIN_BODY, simulateToss, true);
});

const fallbackFor = (reducedMotion: boolean) => (reducedMotion ? reducedFallback : fallback);

function apex(frames: Float32Array): number {
  return Math.max(
    ...Array.from({ length: frameCount(frames) }, (_, i) => framePose(frames, i).position[1]),
  );
}

function lastPose(plan: Pick<TossPlan<CoinValue>, 'frames'>): Pose {
  return framePose(plan.frames, frameCount(plan.frames) - 1);
}

function shownUpFace(plan: TossPlan<CoinValue>) {
  const shown = multiply(lastPose(plan).quaternion, plan.visualOffset);
  return upFace(shown, COIN_BODY.faces);
}

function plan(overrides: Partial<Parameters<typeof planToss<CoinValue>>[0]> = {}) {
  return planToss<CoinValue>({
    body: COIN_BODY,
    start: INITIAL_POSE,
    reducedMotion: false,
    fallback: fallbackFor,
    simulate: simulateToss,
    ...overrides,
  });
}

describe('planToss', () => {
  it('shows the chosen outcome on top for every one of 200 consecutive plans', () => {
    const source = seededSource(2024);
    const chosen = { heads: 0, tails: 0 };
    const shown = { heads: 0, tails: 0 };
    let start = INITIAL_POSE;
    for (let i = 0; i < 200; i += 1) {
      const result = plan({ start, source });
      const face = shownUpFace(result);
      expect(COIN_BODY.faces[face.index]!.value).toBe(result.outcome);
      expect(face.tiltDeg).toBeLessThanOrEqual(MAX_REST_TILT_DEG);
      expect(result.durationS).toBeGreaterThan(0);
      expect(result.blend.endS).toBeLessThan(result.durationS);
      chosen[result.outcome] += 1;
      shown[COIN_BODY.faces[face.index]!.value] += 1;
      start = {
        ...lastPose(result),
        quaternion: multiply(lastPose(result).quaternion, result.visualOffset),
      };
    }
    expect(shown).toEqual(chosen);
    expect(chosen.heads).toBeGreaterThan(60);
    expect(chosen.tails).toBeGreaterThan(60);
  });

  it('starts every plan at the given start pose', () => {
    const start: Pose = {
      position: [1, INITIAL_POSE.position[1], -1.5],
      quaternion: fromAxisAngle([1, 0, 0], Math.PI),
    };
    const result = plan({ start, source: seededSource(9) });
    const first = framePose(result.frames, 0);
    for (let k = 0; k < 3; k += 1) expect(first.position[k]).toBeCloseTo(start.position[k]!, 5);
    expect(Math.abs(first.quaternion[0])).toBeCloseTo(1, 5);
  });

  it('eases the visual offset in only while the body is high enough to clear the table', () => {
    const source = seededSource(77);
    for (let i = 0; i < 20; i += 1) {
      const result = plan({ source });
      if (result.visualOffset[3] > 1 - 1e-9) continue;
      const window = findBlendWindow(result.frames, COIN_BODY.clearance)!;
      expect(result.blend).toEqual(window);
      expect(result.blend.endS - result.blend.startS).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('falls back after three rejected attempts and still shows the chosen outcome', () => {
    const neverSettles = vi.fn((input: TossInput): Simulation => ({
      ...simulateToss(input),
      settled: false,
    }));
    const source = seededSource(5);
    for (let i = 0; i < 10; i += 1) {
      const result = plan({ simulate: neverSettles, source });
      expect(result.usedFallback).toBe(true);
      expect(result.attempts).toBe(MAX_ATTEMPTS);
      expect(COIN_BODY.faces[shownUpFace(result).index]!.value).toBe(result.outcome);
    }
    expect(neverSettles).toHaveBeenCalledTimes(10 * MAX_ATTEMPTS);
  });

  it('rejects a coin resting on its edge', () => {
    const leaning = (input: TossInput): Simulation => {
      const sim = simulateToss(input);
      const frames = sim.frames.slice();
      const last = frameCount(frames) - 1;
      frames.set(fromAxisAngle([0, 0, 1], (40 * Math.PI) / 180), last * 7 + 3);
      return { ...sim, frames };
    };
    const result = plan({ simulate: leaning, source: seededSource(6) });
    expect(result.usedFallback).toBe(true);
  });

  it('anchors the fallback at a tails-up start away from where it was recorded', () => {
    const start: Pose = {
      position: [-1.2, INITIAL_POSE.position[1], 2],
      quaternion: multiply(fromAxisAngle([0, 1, 0], 0.7), fromAxisAngle([1, 0, 0], Math.PI)),
    };
    const anchored = anchorTrajectory(fallback, start, COIN_BODY);
    const first = framePose(anchored.frames, 0);
    for (let k = 0; k < 3; k += 1) expect(first.position[k]).toBeCloseTo(start.position[k]!, 5);
    const rest = framePose(anchored.frames, frameCount(anchored.frames) - 1);
    expect(upFace(rest.quaternion, COIN_BODY.faces).tiltDeg).toBeLessThan(MAX_REST_TILT_DEG);
    expect(rest.position[1]).toBeCloseTo(
      framePose(fallback.frames, frameCount(fallback.frames) - 1).position[1],
      5,
    );
  });

  it('lands both anchored fallbacks flat and inside the walls from a start leaning on a wall', () => {
    for (const recorded of [fallback, reducedFallback]) {
      const landing = recorded.contacts[0]!.frame;
      for (const start of wallStarts(COIN_BODY, 16)) {
        const anchored = anchorTrajectory(recorded, start, COIN_BODY);
        const first = framePose(anchored.frames, 0);
        for (let k = 0; k < 3; k += 1) expect(first.position[k]).toBeCloseTo(start.position[k]!, 5);
        expect(wallOvershoot(anchored.frames, COIN_BODY, landing)).toBeLessThanOrEqual(1e-6);
        const rest = framePose(anchored.frames, frameCount(anchored.frames) - 1);
        expect(upFace(rest.quaternion, COIN_BODY.faces).tiltDeg).toBeLessThan(1);
      }
    }
  });

  it('uses only the reduced profile under reduced motion and flies lower and shorter', () => {
    const source = seededSource(31);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const neverSettles = (input: TossInput): Simulation => ({
      ...simulateToss(input),
      settled: false,
    });
    const requested: boolean[] = [];
    const reduced = [
      ...Array.from({ length: 30 }, () => plan({ reducedMotion: true, source })),
      ...Array.from({ length: 10 }, () =>
        plan({
          reducedMotion: true,
          simulate: neverSettles,
          fallback: (reducedMotion) => {
            requested.push(reducedMotion);
            return fallbackFor(reducedMotion);
          },
          source,
        }),
      ),
    ];
    const normal = Array.from({ length: 30 }, () => plan({ source })).filter(
      (p) => p.profile === 'normal',
    );
    expect(requested).toEqual(Array.from({ length: 10 }, () => true));
    expect(reduced.filter((p) => p.usedFallback)).toHaveLength(10);
    expect(reduced.every((p) => p.profile === 'reduced')).toBe(true);
    expect(normal.length).toBeGreaterThan(10);
    const apexes = reduced.map((p) => apex(p.frames));
    expect(Math.max(...apexes)).toBeLessThan(Math.min(...normal.map((p) => apex(p.frames))));
    expect(mean(reduced.map((p) => p.durationS))).toBeLessThan(
      mean(normal.map((p) => p.durationS)),
    );
  });

  it('refuses to record a fallback without spin rates to try', () => {
    const launch = { ...COIN_BODY.launch, reducedFallback: { lift: 8, halfTurns: [] } };
    const body = { ...COIN_BODY, launch };
    expect(() => precomputeFallback(body, simulateToss, true)).toThrow(/No fallback toss/);
    expect(() => precomputeFallback(body, simulateToss, false)).not.toThrow();
  });

  it('records the reduced-motion fallback no higher than the reduced profile reaches', () => {
    const { reduced, reducedFallback: spec } = COIN_BODY.launch;
    expect(spec.lift).toBeLessThanOrEqual(reduced.lift[1]);
    expect(apex(reducedFallback.frames)).toBeLessThan(apex(fallback.frames));
    expect(durationS(reducedFallback.frames)).toBeLessThan(durationS(fallback.frames));
  });

  it('uses every profile without reduced motion', () => {
    const source = seededSource(32);
    const seen = new Set(Array.from({ length: 60 }, () => plan({ source }).profile));
    expect([...seen].sort()).toEqual(COIN_PROFILES.map((p) => p.name).sort());
    expect(seen.has('reduced')).toBe(false);
  });

  it('simulates the coin without a settle limit or damping after landing', () => {
    const inputs: TossInput[] = [];
    const recording = (input: TossInput): Simulation => {
      inputs.push(input);
      return simulateToss(input);
    };
    const source = seededSource(42);
    for (let i = 0; i < 10; i += 1) plan({ simulate: recording, source });
    expect(inputs.length).toBeGreaterThanOrEqual(10);
    for (const input of inputs) {
      expect(input.maxSimulatedS).toBeUndefined();
      expect(input.landedDamping).toBeUndefined();
    }
  });

  it('throws when the fallback cannot show the outcome', () => {
    const flat: Trajectory = { frames: new Float32Array([0, 0.07, 0, ...IDENTITY]), contacts: [] };
    const neverSettles = (input: TossInput): Simulation => ({
      ...simulateToss(input),
      settled: false,
    });
    // The one-frame fallback rests heads up, so every seed that picks tails must throw.
    const outcomes = [1, 2, 3, 4, 5, 6].map((seed) => {
      try {
        const options = {
          fallback: () => flat,
          simulate: neverSettles,
          source: seededSource(seed),
        };
        return plan(options).outcome;
      } catch {
        return 'threw';
      }
    });
    expect(outcomes).toContain('threw');
    expect(outcomes.filter((o) => o !== 'threw').every((o) => o === 'heads')).toBe(true);
  });
});
