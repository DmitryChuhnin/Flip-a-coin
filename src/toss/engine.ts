import type { Pose } from '../math/quat';
import { initPhysics, simulateToss } from '../physics/simulate';
import type { TossBody } from './body';
import { planToss, precomputeFallback, type TossPlan, type Trajectory } from './planToss';

export interface TossEngine {
  /** Records the body's fallback toss now, so the first tap does not pay for it. */
  prepare<V extends string>(body: TossBody<V>): void;
  plan<V extends string>(body: TossBody<V>, start: Pose, reducedMotion: boolean): TossPlan<V>;
}

/** Loads the physics engine; tossing is unavailable until this resolves. */
export async function createTossEngine(): Promise<TossEngine> {
  await initPhysics();
  // Recorded on first use, so only the bodies actually tossed pay for it.
  const fallbacks = new WeakMap<object, Trajectory>();
  const fallbackFor = <V extends string>(body: TossBody<V>): Trajectory => {
    let fallback = fallbacks.get(body);
    if (!fallback) {
      fallback = precomputeFallback(body, simulateToss);
      fallbacks.set(body, fallback);
    }
    return fallback;
  };
  return {
    prepare: (body) => void fallbackFor(body),
    plan: (body, start, reducedMotion) =>
      planToss({ body, start, reducedMotion, fallback: fallbackFor(body), simulate: simulateToss }),
  };
}
