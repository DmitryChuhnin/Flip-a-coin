import { describe, expect, it } from 'vitest';
import { COIN_BODY } from '../coin/coinSpec';
import { createDie } from '../dice/dieSpec';
import { fromAxisAngle, IDENTITY, type Quat } from '../math/quat';
import { defineBody, type TossBody } from './body';

type Spec = Omit<TossBody<string>, 'remaps'>;

function specOf(body: TossBody<string>): Spec {
  const spec: Partial<TossBody<string>> = { ...body };
  delete spec.remaps;
  return spec as Spec;
}

const D20 = specOf(createDie('d20').body);
const COIN = specOf(COIN_BODY);

describe('defineBody', () => {
  it('accepts the coin and builds a complete remap table', () => {
    const body = defineBody(COIN);
    expect(body.remaps).toHaveLength(2);
    expect(body.remaps.every((row) => row.every((candidates) => candidates.length > 0))).toBe(true);
  });

  it.each<[string, (spec: Spec) => Spec, RegExp]>([
    ['a d20 with a face missing', (s) => ({ ...s, faces: s.faces.slice(1) }), /faces onto faces/],
    [
      'a d20 with an extra face',
      (s) => ({ ...s, faces: [...s.faces, { value: '21', normal: [0, 1, 0] }] }),
      /faces onto faces/,
    ],
    [
      'a face direction that is not unit length',
      (s) => ({
        ...s,
        faces: s.faces.map((f, i) =>
          i === 3
            ? { ...f, normal: [f.normal[0] * 1.01, f.normal[1] * 1.01, f.normal[2] * 1.01] }
            : f,
        ),
      }),
      /not a unit vector/,
    ],
    [
      'a zero face direction',
      (s) => ({ ...s, faces: s.faces.map((f, i) => (i === 0 ? { ...f, normal: [0, 0, 0] } : f)) }),
      /not a unit vector/,
    ],
    [
      'a NaN face direction',
      (s) => ({
        ...s,
        faces: s.faces.map((f, i) => (i === 0 ? { ...f, normal: [Number.NaN, 1, 0] } : f)),
      }),
      /not a unit vector/,
    ],
    [
      'duplicate face values',
      (s) => ({ ...s, faces: s.faces.map((f, i) => (i === 1 ? { ...f, value: '1' } : f)) }),
      /distinct/,
    ],
    ['a single face', (s) => ({ ...s, faces: s.faces.slice(0, 1) }), /two faces/],
    ['no faces', (s) => ({ ...s, faces: [] }), /two faces/],
    [
      'a rotation that is not a symmetry',
      (s) => ({ ...s, symmetries: [...s.symmetries, fromAxisAngle([0, 1, 0], 0.3)] }),
      /does not map the hull/,
    ],
    [
      'a quaternion that is not unit length',
      (s) => ({ ...s, symmetries: [...s.symmetries, [0, 0, 0, 2] as Quat] }),
      /unit quaternions/,
    ],
    ['no symmetries', (s) => ({ ...s, symmetries: [] }), /unit quaternions/],
    ['only the identity', (s) => ({ ...s, symmetries: [IDENTITY] }), /No symmetry maps/],
    ['a hull of three points', (s) => ({ ...s, hull: s.hull.slice(0, 9) }), /four finite/],
    [
      'a hull not made of triples',
      (s) => ({ ...s, hull: s.hull.slice(0, s.hull.length - 1) }),
      /four finite/,
    ],
    [
      'a hull with NaN',
      (s) => ({ ...s, hull: Float32Array.from(s.hull, (v, i) => (i === 5 ? Number.NaN : v)) }),
      /four finite/,
    ],
    ['zero density', (s) => ({ ...s, density: 0 }), /Density/],
    ['clearance inside the hull', (s) => ({ ...s, clearance: 0.5 }), /Clearance/],
    [
      'a start pose floating above the table',
      (s) => ({
        ...s,
        initialPose: {
          ...s.initialPose,
          position: [0, s.initialPose.position[1] + 0.01, 1],
        },
      }),
      /rest on the table/,
    ],
    [
      'a start pose on an edge',
      (s) => ({
        ...s,
        initialPose: { position: [0, 1, 1], quaternion: fromAxisAngle([1, 0, 0], 0.4) },
      }),
      /rest flat/,
    ],
  ])('rejects %s', (_, change, message) => {
    expect(() => defineBody(change(D20))).toThrow(message);
  });
});
