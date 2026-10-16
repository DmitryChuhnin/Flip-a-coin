import { describe, expect, it } from 'vitest';
import { COIN_BODY } from '../coin/coinSpec';
import { createDie, DIE_KINDS } from '../dice/dieSpec';
import { dot3, length3, type Vec3 } from '../math/quat';
import { seededSource } from '../testing/seededSource';
import { bodyReach, hullVectors, type TossBody } from '../toss/body';
import { upFace } from '../toss/faces';
import { modelBody, type ModelShape } from './modelBody';

const ITEMS: [string, TossBody<string>][] = [
  ['coin', COIN_BODY],
  ...DIE_KINDS.map((kind): [string, TossBody<string>] => [kind, createDie(kind).body]),
];

/** The item's own hull and faces in meters, as a file made from it would carry them. */
function asModel(body: TossBody<string>): ModelShape {
  return {
    points: hullVectors(body.hull).map((p) => [p[0] / 100, p[1] / 100, p[2] / 100]),
    faces: body.faces.map((face) => ({ value: face.value, normal: [...face.normal] })),
  };
}

/** Each point moved by `share` of the reach in a random direction. */
function jitter(points: readonly Vec3[], share: number): Vec3[] {
  const next = seededSource(1);
  const unit = () => next() / 2 ** 32;
  const step = share * Math.max(...points.map(length3));
  return points.map((p): Vec3 => {
    const z = 2 * unit() - 1;
    const angle = 2 * Math.PI * unit();
    const across = Math.sqrt(1 - z * z) * step;
    return [p[0] + across * Math.cos(angle), p[1] + across * Math.sin(angle), p[2] + z * step];
  });
}

/** A prism on a regular n-gon, shaped like the coin, in meters. */
function prism(n: number): Vec3[] {
  return [-1, 1].flatMap((y) =>
    Array.from({ length: n }, (_, k): Vec3 => {
      const angle = (2 * Math.PI * k) / n;
      return [0.006 * Math.cos(angle), 0.0007 * y, 0.006 * Math.sin(angle)];
    }),
  );
}

const D6 = createDie('d6').body;
const D8 = createDie('d8').body;
const AXES: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
/** A d6 whose faces point along the axes; opposite values sum to 7. */
const AXIS_FACES = AXES.map((normal, i) => ({ value: [1, 6, 2, 5, 3, 4][i], normal }));
const CUBE: Vec3[] = [-1, 1].flatMap((x) =>
  [-1, 1].flatMap((y) => [-1, 1].map((z): Vec3 => [x / 100, y / 100, z / 100])),
);

describe('modelBody', () => {
  it.each(ITEMS)('accepts the %s described as a model in meters', (_, template) => {
    const { body, scale } = modelBody(asModel(template), template);
    expect(scale).toBeCloseTo(100, 4);
    expect(body.faces.map((face) => face.value)).toEqual(template.faces.map((face) => face.value));
    expect(body.symmetries).toHaveLength(template.symmetries.length);
    expect(body.launch.touchdown.flat).toBeCloseTo(template.launch.touchdown.flat, 5);
    const startOf = (b: TossBody<string>) =>
      b.faces[upFace(b.initialPose.quaternion, b.faces).index]!.value;
    expect(startOf(body)).toBe(startOf(template));
  });

  it('reads faces from a JSON string with numbers for die values', () => {
    const { body } = modelBody({ points: CUBE, faces: JSON.stringify(AXIS_FACES) }, D6);
    expect(body.faces.map((face) => face.value)).toEqual(['1', '6', '2', '5', '3', '4']);
    expect(body.symmetries).toHaveLength(24);
    // A cube with the d6 reach rests a half edge, reach / √3, above the table.
    const halfEdge = bodyReach(D6.hull) / Math.sqrt(3);
    expect(body.launch.touchdown.flat).toBeCloseTo(halfEdge, 5);
    expect(body.initialPose.position[1]).toBeCloseTo(halfEdge, 5);
  });

  it.each(ITEMS)('accepts the %s with corners off by 3e-7 of the reach', (_, template) => {
    const model = asModel(template);
    const points = jitter(model.points, 3e-7);
    expect(() => modelBody({ ...model, points }, template)).not.toThrow();
  });

  // A rotation found on the corners carries their error into the normals checked to 1e-6.
  it.each(ITEMS)('rejects the %s with corners off by 1e-6 of the reach', (_, template) => {
    const model = asModel(template);
    const points = jitter(model.points, 1e-6);
    expect(() => modelBody({ ...model, points }, template)).toThrow(RangeError);
  });

  it('keeps only the corners: an outline engraved in each side does not count', () => {
    const { points, faces } = asModel(D8);
    const outline = D8.faces.flatMap((face, i) => {
      const height = Math.max(...points.map((p) => dot3(p, face.normal)));
      const side = points.filter((p) => height - dot3(p, face.normal) < 1e-9);
      // Weights differ per side, as the numbers do; a zero weight puts the point on an edge.
      return [
        [1, i + 2, 0],
        [3, 1, i + 1],
        [2, 5, 1 + (i % 3)],
      ].map((weights): Vec3 => {
        const sum = weights.reduce((total, w) => total + w, 0);
        // A file stores float32, which puts some of the points just outside the side.
        const [x, y, z] = [0, 1, 2].map((axis) =>
          Math.fround(side.reduce((total, p, k) => total + p[axis]! * weights[k]!, 0) / sum),
        );
        return [x!, y!, z!];
      });
    });
    const { body } = modelBody({ points: [...points, ...outline], faces }, D8);
    expect(body.hull).toHaveLength(D8.hull.length);
    expect(body.symmetries).toHaveLength(D8.symmetries.length);
  });

  it('takes a point raised above the middle of a side by 5e-6 of the reach as part of it', () => {
    const { points, faces } = asModel(D8);
    const normal = D8.faces[0]!.normal;
    const height = Math.max(...points.map((p) => dot3(p, normal)));
    const side = points.filter((p) => height - dot3(p, normal) < 1e-9);
    const rise = 5e-6 * Math.max(...points.map(length3));
    const [x, y, z] = [0, 1, 2].map(
      (axis) => side.reduce((sum, p) => sum + p[axis]!, 0) / side.length + rise * normal[axis]!,
    );
    const { body } = modelBody({ points: [...points, [x!, y!, z!]], faces }, D8);
    expect(body.hull).toHaveLength(D8.hull.length);
  });

  it('accepts a round coin of 256 corners and rejects one of more', () => {
    const { faces } = asModel(COIN_BODY);
    expect(modelBody({ points: prism(128), faces }, COIN_BODY).body.hull).toHaveLength(256 * 3);
    expect(() => modelBody({ points: prism(129), faces }, COIN_BODY)).toThrow(
      /258 corners, more than 256/,
    );
  });

  it('accepts a sheared coin with its center of mass above its base and rejects one beyond', () => {
    const { points, faces } = asModel(COIN_BODY);
    const sheared = (k: number) => points.map((p): Vec3 => [p[0] + k * p[1], p[1], p[2]]);
    expect(() => modelBody({ points: sheared(4), faces }, COIN_BODY)).not.toThrow();
    expect(() => modelBody({ points: sheared(12), faces }, COIN_BODY)).toThrow(RangeError);
    expect(() => modelBody({ points: sheared(12), faces }, COIN_BODY)).toThrow(
      /center of mass is outside the side it rests on/,
    );
  });

  it('ignores the scale of the file: a cube of any size gets the d6 reach', () => {
    const big = CUBE.map((p): Vec3 => [p[0] * 1000, p[1] * 1000, p[2] * 1000]);
    const small = modelBody({ points: CUBE, faces: AXIS_FACES }, D6);
    const large = modelBody({ points: big, faces: AXIS_FACES }, D6);
    expect(large.scale * 1000).toBeCloseTo(small.scale, 6);
    expect(Array.from(large.body.hull)).toEqual(Array.from(small.body.hull));
  });

  const withFace = (i: number, face: unknown) => AXIS_FACES.map((f, j) => (j === i ? face : f));
  it.each<[string, ModelShape, RegExp]>([
    ['no faces property', { points: CUBE, faces: undefined }, /no faces property/],
    ['faces set to null', { points: CUBE, faces: null }, /must be an array/],
    ['faces set to a number', { points: CUBE, faces: 6 }, /must be an array/],
    ['faces as broken JSON', { points: CUBE, faces: '[{"value": 1' }, /not valid JSON/],
    ['faces as JSON of an object', { points: CUBE, faces: '{"value": 1}' }, /must be an array/],
    ['five faces on a d6', { points: CUBE, faces: AXIS_FACES.slice(1) }, /5 faces, the item has 6/],
    ['no faces at all', { points: CUBE, faces: [] }, /0 faces/],
    [
      'a value the die does not have',
      { points: CUBE, faces: withFace(0, { value: 7, normal: [1, 0, 0] }) },
      /value 7, not one of/,
    ],
    [
      'a fractional value',
      { points: CUBE, faces: withFace(0, { value: 1.5, normal: [1, 0, 0] }) },
      /value 1.5/,
    ],
    [
      'a face without a value',
      { points: CUBE, faces: withFace(0, { normal: [1, 0, 0] }) },
      /value undefined/,
    ],
    ['a face that is not an object', { points: CUBE, faces: withFace(0, 1) }, /value undefined/],
    [
      'a normal of two numbers',
      { points: CUBE, faces: withFace(0, { value: 1, normal: [1, 0] }) },
      /three finite numbers/,
    ],
    [
      'a normal with a string',
      { points: CUBE, faces: withFace(0, { value: 1, normal: [1, 0, '0'] }) },
      /three finite numbers/,
    ],
    [
      'a normal with NaN',
      { points: CUBE, faces: withFace(0, { value: 1, normal: [Number.NaN, 0, 0] }) },
      /three finite numbers/,
    ],
    [
      'a repeated value',
      { points: CUBE, faces: withFace(1, { value: 1, normal: [-1, 0, 0] }) },
      /distinct/,
    ],
    [
      'a normal that is not unit length',
      { points: CUBE, faces: withFace(0, { value: 1, normal: [1.01, 0, 0] }) },
      /not a unit vector/,
    ],
    [
      'faces that point at corners: an octahedron with cube faces',
      {
        points: AXES.map((p): Vec3 => [p[0] / 100, p[1] / 100, p[2] / 100]),
        faces: AXIS_FACES,
      },
      /does not rest on a flat side/,
    ],
    [
      'normals turned off the faces',
      {
        points: CUBE,
        faces: AXIS_FACES.map((f) => ({
          ...f,
          normal: [
            f.normal[0] * 0.6 + f.normal[2] * 0.8,
            f.normal[1],
            f.normal[2] * 0.6 - f.normal[0] * 0.8,
          ],
        })),
      },
      /faces onto faces/,
    ],
    ['a collider of three points', { points: CUBE.slice(0, 3), faces: AXIS_FACES }, /four finite/],
    [
      'a collider with NaN',
      { points: [...CUBE.slice(1), [Number.NaN, 0, 0]], faces: AXIS_FACES },
      /four finite/,
    ],
    [
      'a collider of one point',
      { points: [0, 1, 2, 3].map((): Vec3 => [0, 0, 0]), faces: AXIS_FACES },
      /no size/,
    ],
    [
      'a collider on one line',
      { points: [-2, -1, 1, 2].map((t): Vec3 => [t / 100, 0, 0]), faces: AXIS_FACES },
      /one line/,
    ],
    [
      'a collider of one point off the origin',
      { points: [0, 1, 2, 3].map((): Vec3 => [0.01, 0.01, 0]), faces: AXIS_FACES },
      /one line/,
    ],
    [
      'a flat collider',
      { points: CUBE.map((p): Vec3 => [p[0], p[1], 0]), faces: AXIS_FACES },
      /is flat/,
    ],
    [
      'a collider with one corner moved',
      { points: [[0.011, 0.01, 0.01], ...CUBE.slice(0, 7)], faces: AXIS_FACES },
      /No symmetry maps|faces onto faces/,
    ],
    [
      'a corner off by a ten-thousandth of the reach',
      { points: [[0.010002, 0.01, 0.01], ...CUBE.slice(0, 7)], faces: AXIS_FACES },
      /No symmetry maps/,
    ],
    [
      'a collider whose origin is off the center',
      { points: CUBE.map((p): Vec3 => [p[0] + 0.005, p[1], p[2]]), faces: AXIS_FACES },
      /No symmetry maps|faces onto faces/,
    ],
  ])('rejects %s with a RangeError', (_, shape, message) => {
    expect(() => modelBody(shape, D6)).toThrow(RangeError);
    expect(() => modelBody(shape, D6)).toThrow(message);
  });

  it('rejects coin faces with die values', () => {
    const faces = [
      { value: 1, normal: [0, 1, 0] },
      { value: 2, normal: [0, -1, 0] },
    ];
    expect(() => modelBody({ ...asModel(COIN_BODY), faces }, COIN_BODY)).toThrow(
      /value 1, not one of heads, tails/,
    );
  });
});
