import { beforeAll, describe, expect, it } from 'vitest';
import { COIN_BODY } from '../coin/coinSpec';
import { createDie } from '../dice/dieSpec';
import { frameCount, framePose } from '../physics/frames';
import { initPhysics, simulateToss, type Simulation, type TossInput } from '../physics/simulate';
import { MAX_ATTEMPTS } from './planToss';
import { createTossEngine } from './engine';

beforeAll(async () => {
  await initPhysics();
});

/** Simulates for real until `reject` is set, then reports every toss as never settling. */
function switchable() {
  const state = { reject: false, calls: 0 };
  const simulate = (input: TossInput): Simulation => {
    state.calls += 1;
    const sim = simulateToss(input);
    return state.reject ? { ...sim, settled: false } : sim;
  };
  return { state, simulate };
}

function apex(frames: Float32Array): number {
  let top = -Infinity;
  for (let i = 0; i < frameCount(frames); i += 1)
    top = Math.max(top, framePose(frames, i).position[1]);
  return top;
}

describe('createTossEngine', () => {
  it.each([
    ['coin', COIN_BODY],
    ['d12', createDie('d12').body],
  ] as const)(
    'records both fallbacks of the %s on prepare and plays the one for the motion setting',
    async (_, body) => {
      const { state, simulate } = switchable();
      const engine = await createTossEngine(simulate);
      engine.prepare(body);
      expect(state.calls).toBeGreaterThanOrEqual(2);

      state.reject = true;
      state.calls = 0;
      const normal = engine.plan(body, body.initialPose, false);
      const reduced = engine.plan(body, body.initialPose, true);
      // Both fallbacks were recorded up front: the plans only run their own attempts.
      expect(state.calls).toBe(2 * MAX_ATTEMPTS);
      expect(normal.usedFallback && reduced.usedFallback).toBe(true);
      expect(apex(reduced.frames)).toBeLessThan(apex(normal.frames) - 0.3);
    },
  );
});
