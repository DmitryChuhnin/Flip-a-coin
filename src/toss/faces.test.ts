import { describe, expect, it } from 'vitest';
import { COIN_BODY, COIN_FACES } from '../coin/coinSpec';
import { fromAxisAngle, IDENTITY, multiply, rotate, type Quat } from '../math/quat';
import { buildRemapTable, remapRotation, upFace } from './faces';

const REMAPS = COIN_BODY.remaps;

const HALF_TURN_X = fromAxisAngle([1, 0, 0], Math.PI);

describe('upFace', () => {
  it('finds heads up at identity with no tilt', () => {
    expect(upFace(IDENTITY, COIN_FACES)).toEqual({ index: 0, tiltDeg: 0 });
  });

  it('finds tails up after a half-turn about X', () => {
    const face = upFace(HALF_TURN_X, COIN_FACES);
    expect(face.index).toBe(1);
    expect(face.tiltDeg).toBeCloseTo(0, 6);
  });

  it('reports the tilt of a leaning body', () => {
    const face = upFace(fromAxisAngle([0, 0, 1], (30 * Math.PI) / 180), COIN_FACES);
    expect(face.index).toBe(0);
    expect(face.tiltDeg).toBeCloseTo(30, 6);
  });

  it('picks the face pointing more up past 90 degrees of tilt', () => {
    const face = upFace(fromAxisAngle([0, 0, 1], (100 * Math.PI) / 180), COIN_FACES);
    expect(face.index).toBe(1);
    expect(face.tiltDeg).toBeCloseTo(80, 6);
  });

  it('throws on an empty face list', () => {
    expect(() => upFace(IDENTITY, [])).toThrow(RangeError);
  });
});

describe('remapRotation', () => {
  const landedPoses: Quat[] = [
    IDENTITY,
    HALF_TURN_X,
    fromAxisAngle([0.3, 0.8, -0.5], 2.1),
    multiply(fromAxisAngle([0, 1, 0], 1), HALF_TURN_X),
  ];

  for (const [p, pose] of landedPoses.entries()) {
    for (const desired of [0, 1]) {
      it(`puts face ${desired} up exactly for landed pose #${p}`, () => {
        const landed = upFace(pose, COIN_FACES).index;
        const r = remapRotation(REMAPS, landed, desired);
        const shownUp = rotate(multiply(pose, r), COIN_FACES[desired]!.normal);
        const landedUp = rotate(pose, COIN_FACES[landed]!.normal);
        for (let k = 0; k < 3; k += 1) expect(shownUp[k]).toBeCloseTo(landedUp[k]!, 6);
        expect(upFace(multiply(pose, r), COIN_FACES).index).toBe(desired);
      });
    }
  }

  it('returns identity when the landed face is already the desired one', () => {
    expect(remapRotation(REMAPS, 0, 0)).toEqual(IDENTITY);
    expect(remapRotation(REMAPS, 1, 1)).toEqual(IDENTITY);
  });

  it('flips about the horizontal symmetry axis closest to the preferred axis', () => {
    const r = remapRotation(REMAPS, 0, 1, [-0.1, 0, -1]);
    // Half-turn about -Z, the 90 degree axis, with the axis sign following the preference.
    expect(r[3]).toBeCloseTo(0, 9);
    expect(r[0]).toBeCloseTo(0, 6);
    expect(r[2]).toBeCloseTo(-1, 6);
  });

  it('throws when no symmetry maps the desired face onto the landed one', () => {
    expect(() => buildRemapTable(COIN_FACES, [IDENTITY])).toThrow(/No symmetry/);
  });

  it('throws on a face index outside the list', () => {
    expect(() => remapRotation(REMAPS, 0, 2)).toThrow(RangeError);
    expect(() => remapRotation(REMAPS, -1, 0)).toThrow(RangeError);
  });
});
