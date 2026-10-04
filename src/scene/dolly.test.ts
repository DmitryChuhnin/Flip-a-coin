import { describe, expect, it } from 'vitest';
import { computeCameraParams, type Vec3 } from './camera';
import {
  applyDolly,
  DOLLY_AT_REST,
  DOLLY_DURATION_S,
  DOLLY_FRACTION,
  dollyAmount,
  easeOutCubic,
  retarget,
} from './dolly';

const BASE = computeCameraParams(9 / 19.5);
const COIN: Vec3 = [0.5, 0.07, 1];

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('easeOutCubic', () => {
  it('runs from 0 to 1 and clamps outside', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe('applyDolly', () => {
  it('leaves the camera in place at amount 0', () => {
    expect(applyDolly(BASE, COIN, 0)).toEqual(BASE);
  });

  it('moves the camera the dolly fraction of its distance toward the coin at amount 1', () => {
    const moved = applyDolly(BASE, COIN, 1);
    const before = distance(BASE.position, COIN);
    expect(distance(moved.position, COIN)).toBeCloseTo(before * (1 - DOLLY_FRACTION), 9);
    expect(distance(moved.lookAt, COIN)).toBeCloseTo(
      distance(BASE.lookAt, COIN) * (1 - DOLLY_FRACTION),
      9,
    );
    expect(moved.fov).toBe(BASE.fov);
  });
});

describe('dollyAmount', () => {
  it('eases from the start to the target over the dolly duration', () => {
    const move = retarget(DOLLY_AT_REST, 1, 10, false);
    expect(dollyAmount(move, 10, false)).toBe(0);
    expect(dollyAmount(move, 10 + DOLLY_DURATION_S / 2, false)).toBeGreaterThan(0.5);
    expect(dollyAmount(move, 10 + DOLLY_DURATION_S, false)).toBe(1);
    expect(dollyAmount(move, 99, false)).toBe(1);
  });

  it('returns from wherever an interrupted move had reached', () => {
    const forward = retarget(DOLLY_AT_REST, 1, 0, false);
    const midway = dollyAmount(forward, 0.1, false);
    const back = retarget(forward, 0, 0.1, false);
    expect(dollyAmount(back, 0.1, false)).toBeCloseTo(midway, 9);
    expect(dollyAmount(back, 0.1 + DOLLY_DURATION_S, false)).toBe(0);
  });

  it('does not move under reduced motion', () => {
    const move = retarget(DOLLY_AT_REST, 1, 0, true);
    for (const t of [0, 0.1, 0.4, 5]) expect(dollyAmount(move, t, true)).toBe(0);
  });
});
