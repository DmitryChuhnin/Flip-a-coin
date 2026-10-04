import { describe, expect, it } from 'vitest';
import { cryptoSource, pickWeighted, randomInt, randomUnit } from './random';
import { seededSource } from './testing/seededSource';

/** Chi-square critical values at p = 0.001 for n - 1 degrees of freedom. */
const CHI_SQUARE_CRITICAL: Record<number, number> = { 2: 10.83, 6: 20.52, 20: 43.82 };

function sequence(values: number[]) {
  let i = 0;
  return Object.assign(() => values[i++]!, { draws: () => i });
}

describe('randomInt', () => {
  it.each([2, 6, 20])('is uniform over [0, %i) by chi-square on 60k draws', (n) => {
    const source = seededSource(n * 7919);
    const samples = 60_000;
    const counts = new Array<number>(n).fill(0);
    for (let i = 0; i < samples; i += 1) counts[randomInt(n, source)]! += 1;
    const expected = samples / n;
    const chiSquare = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    expect(chiSquare).toBeLessThan(CHI_SQUARE_CRITICAL[n]!);
  });

  it('redraws a value from the rejected tail instead of folding it with modulo', () => {
    // For n = 3 the accepted range is [0, 4294967295); 4294967295 itself is rejected.
    const source = sequence([2 ** 32 - 1, 7]);
    expect(randomInt(3, source)).toBe(1);
    expect(source.draws()).toBe(2);
  });

  it('accepts the last value below the rejection limit on the first draw', () => {
    const source = sequence([2 ** 32 - 2]);
    expect(randomInt(3, source)).toBe((2 ** 32 - 2) % 3);
    expect(source.draws()).toBe(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32 + 1])(
    'throws for n = %s',
    (n) => {
      expect(() => randomInt(n, seededSource(1))).toThrow(RangeError);
    },
  );

  it('always returns 0 for n = 1', () => {
    const source = seededSource(5);
    for (let i = 0; i < 100; i += 1) expect(randomInt(1, source)).toBe(0);
  });

  it.each([-1, 2 ** 32, 0.5, Number.NaN])('throws when the source returns %s', (value) => {
    expect(() => randomInt(2, () => value)).toThrow(RangeError);
  });

  it('draws from crypto.getRandomValues by default', () => {
    const value = cryptoSource();
    expect(Number.isInteger(value) && value >= 0 && value < 2 ** 32).toBe(true);
    expect(randomInt(6)).toBeGreaterThanOrEqual(0);
  });
});

describe('randomUnit', () => {
  it('maps the source range onto [0, 1)', () => {
    expect(randomUnit(() => 0)).toBe(0);
    expect(randomUnit(() => 2 ** 32 - 1)).toBeLessThan(1);
  });
});

describe('pickWeighted', () => {
  it('picks indices in proportion to the weights', () => {
    const source = seededSource(42);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i += 1) counts[pickWeighted([70, 20, 10], source)]! += 1;
    expect(counts[0]! / 30_000).toBeCloseTo(0.7, 1);
    expect(counts[1]! / 30_000).toBeCloseTo(0.2, 1);
    expect(counts[2]! / 30_000).toBeCloseTo(0.1, 1);
  });

  it('never picks a zero-weight index', () => {
    const source = seededSource(3);
    for (let i = 0; i < 1000; i += 1) expect(pickWeighted([0, 5, 0], source)).toBe(1);
  });

  it.each([[[]], [[0, 0]], [[1, -1]], [[1.5, 1]], [[Number.NaN]], [[Number.POSITIVE_INFINITY]]])(
    'throws for weights %j',
    (weights) => {
      expect(() => pickWeighted(weights, seededSource(1))).toThrow(RangeError);
    },
  );
});
