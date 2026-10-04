/** Returns an integer in [0, 2^32). */
export type Uint32Source = () => number;

const RANGE = 2 ** 32;

export const cryptoSource: Uint32Source = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

function draw(source: Uint32Source): number {
  const value = source();
  if (!Number.isInteger(value) || value < 0 || value >= RANGE) {
    throw new RangeError(`Random source returned ${value}, expected an integer in [0, 2^32)`);
  }
  return value;
}

/** Uniform integer in [0, n). Rejection sampling: `value % n` alone favours small results. */
export function randomInt(n: number, source: Uint32Source = cryptoSource): number {
  if (!Number.isInteger(n) || n < 1 || n > RANGE) {
    throw new RangeError(`randomInt needs an integer n in [1, 2^32], got ${n}`);
  }
  const limit = Math.floor(RANGE / n) * n;
  for (;;) {
    const value = draw(source);
    if (value < limit) return value % n;
  }
}

/** Uniform number in [0, 1). For visual variation only, never for outcomes. */
export function randomUnit(source: Uint32Source = cryptoSource): number {
  return draw(source) / RANGE;
}

/** Index chosen with probability weight / sum. Weights are non-negative integers. */
export function pickWeighted(
  weights: readonly number[],
  source: Uint32Source = cryptoSource,
): number {
  let total = 0;
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError(`Weights must be non-negative integers, got ${weight}`);
    }
    total += weight;
  }
  if (total < 1) throw new RangeError('Weights must have a positive sum');

  let rest = randomInt(total, source);
  for (let i = 0; i < weights.length; i += 1) {
    rest -= weights[i]!;
    if (rest < 0) return i;
  }
  throw new Error('unreachable: weights sum mismatch');
}
