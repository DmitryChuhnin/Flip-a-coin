import { COIN_BODY, INITIAL_POSE, type CoinValue } from '../coin/coinSpec';
import type { Pose } from '../math/quat';
import { initPhysics, simulateToss } from '../physics/simulate';
import { planToss, precomputeFallback, type TossPlan } from './planToss';

export interface TossEngine {
  plan(start: Pose, reducedMotion: boolean): TossPlan<CoinValue>;
}

/** Loads the physics engine; tossing is unavailable until this resolves. */
export async function createTossEngine(): Promise<TossEngine> {
  await initPhysics();
  const fallback = precomputeFallback(COIN_BODY, INITIAL_POSE, simulateToss);
  return {
    plan: (start, reducedMotion) =>
      planToss({ body: COIN_BODY, start, reducedMotion, fallback, simulate: simulateToss }),
  };
}
