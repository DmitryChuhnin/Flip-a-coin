import { describe, expect, it } from 'vitest';
import { COIN_SYMMETRIES, hullPoints } from '../coin/coinSpec';
import { hullVectors } from '../toss/body';
import { fromAxisAngle, IDENTITY, type Quat, type Vec3 } from './quat';
import { mapsOntoItself, rotationGroup } from './symmetry';

const SQUARE: Vec3[] = [
  [1, 0, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, 0, -1],
];

function sameRotation(a: Quat, b: Quat): boolean {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 1 - 1e-6;
}

describe('rotationGroup', () => {
  it('finds the 8 rotations of a square, identity first', () => {
    const group = rotationGroup(SQUARE);
    expect(group).toHaveLength(8);
    expect(group[0]).toEqual(IDENTITY);
    for (const q of group) expect(mapsOntoItself(SQUARE, q, 1e-9)).toBe(true);
  });

  it('derives the hand-written coin symmetries from the coin hull', () => {
    const group = rotationGroup(hullVectors(hullPoints()));
    expect(group).toHaveLength(COIN_SYMMETRIES.length);
    for (const q of COIN_SYMMETRIES) expect(group.some((g) => sameRotation(g, q))).toBe(true);
  });

  it('finds only the identity for a set without symmetry', () => {
    const points: Vec3[] = [
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 3],
      [-1, -1, -1],
    ];
    expect(rotationGroup(points)).toEqual([IDENTITY]);
  });

  it.each([
    ['no points', []],
    ['one point', [[1, 0, 0]]],
    [
      'points on one line',
      [
        [1, 0, 0],
        [-2, 0, 0],
      ],
    ],
    [
      'only the origin',
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
    ],
    [
      'a non-finite point',
      [
        [1, 0, 0],
        [0, Number.NaN, 0],
      ],
    ],
  ] as [string, Vec3[]][])('throws for %s', (_, points) => {
    expect(() => rotationGroup(points)).toThrow(RangeError);
  });
});

describe('mapsOntoItself', () => {
  it('rejects a rotation that moves a point off the set', () => {
    expect(mapsOntoItself(SQUARE, fromAxisAngle([0, 1, 0], Math.PI / 4), 1e-6)).toBe(false);
    expect(mapsOntoItself(SQUARE, fromAxisAngle([0, 1, 0], Math.PI / 2), 1e-6)).toBe(true);
  });
});
