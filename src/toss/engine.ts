import type { Pose } from '../math/quat';
import { initPhysics, simulateToss } from '../physics/simulate';
import type { TossBody } from './body';
import { planToss, precomputeFallback, type TossPlan, type Trajectory } from './planToss';

export interface TossEngine {
  /** Records the body's fallback tosses now, so the first tap does not pay for them. */
  prepare<V extends string>(body: TossBody<V>): void;
  plan<V extends string>(body: TossBody<V>, start: Pose, reducedMotion: boolean): TossPlan<V>;
}

/** Loads the physics engine; tossing is unavailable until this resolves. */
export async function createTossEngine(): Promise<TossEngine> {
  await initPhysics();
  // Recorded on first use, so only the bodies actually tossed pay for it.
  const recorded = {
    normal: new WeakMap<object, Trajectory>(),
    reduced: new WeakMap<object, Trajectory>(),
  };
  const fallbackFor = <V extends string>(body: TossBody<V>, reducedMotion: boolean): Trajectory => {
    const fallbacks = reducedMotion ? recorded.reduced : recorded.normal;
    let fallback = fallbacks.get(body);
    if (!fallback) {
      fallback = precomputeFallback(body, simulateToss, reducedMotion);
      fallbacks.set(body, fallback);
    }
    return fallback;
  };
  return {
    prepare: (body) => {
      fallbackFor(body, false);
      fallbackFor(body, true);
    },
    plan: (body, start, reducedMotion) =>
      planToss({
        body,
        start,
        reducedMotion,
        fallback: (reduced) => fallbackFor(body, reduced),
        simulate: simulateToss,
      }),
  };
}
