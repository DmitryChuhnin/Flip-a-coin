import type { Uint32Source } from '../random';

/** Deterministic mulberry32 generator for tests; never used for real outcomes. */
export function seededSource(seed: number): Uint32Source & { draws: () => number } {
  let state = seed >>> 0;
  let count = 0;
  const next = () => {
    count += 1;
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return Object.assign(next, { draws: () => count });
}
