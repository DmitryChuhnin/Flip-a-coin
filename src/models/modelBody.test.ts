import { Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { describe, expect, it } from 'vitest';
import { COIN_BODY } from '../coin/coinSpec';
import { createDie, DIE_KINDS } from '../dice/dieSpec';
import { dot3, length3, rotate, type Vec3 } from '../math/quat';
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

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The farthest any symmetry takes a hull point from the hull, as a share of the reach, and a normal from the normals. */
function symmetryError(body: TossBody<string>): { hull: number; normals: number } {
  const points = hullVectors(body.hull);
  const normals = body.faces.map((face) => face.normal);
  const off = (set: readonly Vec3[], q: (typeof body.symmetries)[number]) =>
    Math.max(...set.map((p) => Math.min(...set.map((s) => distance(rotate(q, p), s)))));
  return {
    hull: Math.max(...body.symmetries.map((q) => off(points, q))) / bodyReach(body.hull),
    normals: Math.max(...body.symmetries.map((q) => off(normals, q))),
  };
}

/** The farthest aligning moved the normal of a value; one given another side's normal is far off. */
function normalShift(
  body: TossBody<string>,
  faces: readonly { value: string | number; normal: Vec3 }[],
): number {
  const given = (value: string) => faces.find((face) => String(face.value) === value)!.normal;
  return Math.max(...body.faces.map((face) => distance(face.normal, given(face.value))));
}

/** Blender's Ico Sphere at Subdivisions 1, from its vertex table, exported with +Y Up. */
const BLENDER_ICO: Vec3[] = [
  [0, 0, -200],
  [144.72, -105.144, -89.443],
  [-55.277, -170.128, -89.443],
  [-178.885, 0, -89.443],
  [-55.277, 170.128, -89.443],
  [144.72, 105.144, -89.443],
  [55.277, -170.128, 89.443],
  [-144.72, -105.144, 89.443],
  [-144.72, 105.144, 89.443],
  [55.277, 170.128, 89.443],
  [178.885, 0, 89.443],
  [0, 0, 200],
].map(([x, y, z]): Vec3 => [Math.fround(x! / 200), Math.fround(z! / 200), Math.fround(-y! / 200)]);

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
const D4 = createDie('d4').body;
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

/** An octahedron in meters with each tip four points `r` off the axis and `drop` below the apex. */
function octahedron(r: number, drop: number): Vec3[] {
  return AXES.flatMap((axis) => {
    const at = (side: Vec3, k: number) => (axis[k]! * (1 - drop) + side[k]! * r) / 100;
    const tip = AXES.filter((side) => dot3(side, axis) === 0).map((side): Vec3 => [
      at(side, 0),
      at(side, 1),
      at(side, 2),
    ]);
    return drop > 0 ? [...tip, [axis[0] / 100, axis[1] / 100, axis[2] / 100]] : tip;
  });
}

/** A normal turned a quarter about x, as a script that skips or repeats the Z-up turn writes it. */
const quarterX = (n: Vec3, sign: number): Vec3 => [n[0], -sign * n[2], sign * n[1]];

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

  it.each(ITEMS)(
    'makes the %s with corners off by 1e-4 of the reach and normals taken from them exactly symmetric, each normal within 1e-3 of the one given for its value',
    (name, template) => {
      const points = jitter(asModel(template).points, 1e-4);
      const hull = new ConvexHull().setFromPoints(points.map((p) => new Vector3(...p)));
      // The area-weighted normal of the hull triangles that make up the side facing `n`.
      const side = (n: Vec3): Vec3 => {
        const sum = new Vector3();
        for (const face of hull.faces) {
          if (face.normal.dot(new Vector3(...n)) > Math.cos(0.05)) {
            sum.addScaledVector(face.normal, face.area);
          }
        }
        sum.normalize();
        return [sum.x, sum.y, sum.z];
      };
      // A d4 outcome is a vertex, which points away from the side across from it.
      const flip = (n: Vec3): Vec3 => [-n[0], -n[1], -n[2]];
      const faces = template.faces.map((face) => ({
        value: face.value,
        normal: name === 'd4' ? flip(side(flip(face.normal))) : side(face.normal),
      }));
      expect(faces[0]!.normal).not.toEqual(template.faces[0]!.normal);
      const { body } = modelBody({ points, faces }, template);
      expect(body.symmetries).toHaveLength(template.symmetries.length);
      const error = symmetryError(body);
      expect(error.hull).toBeLessThan(1e-6);
      expect(error.normals).toBeLessThan(1e-12);
      expect(normalShift(body, faces)).toBeLessThan(1e-3);
    },
  );

  it.each(ITEMS)('rejects the %s with corners off by 1e-3 of the reach', (_, template) => {
    const model = asModel(template);
    const points = jitter(model.points, 1e-3);
    expect(() => modelBody({ ...model, points }, template)).toThrow(RangeError);
    expect(() => modelBody({ ...model, points }, template)).toThrow(
      /No rotation of the model carries the face of .+; its corners may be too far off/,
    );
  });

  it("accepts a d20 made from Blender's Ico Sphere, up to 1.4e-5 of the radius off, each normal within 1e-3 of the one given for its value", () => {
    const d20 = createDie('d20').body;
    const edge = Math.min(
      ...BLENDER_ICO.flatMap((p, i) => BLENDER_ICO.slice(i + 1).map((s) => distance(p, s))),
    );
    // A face of an icosahedron is three vertices an edge apart; its normal points at their middle.
    const faces: { value: number; normal: Vec3 }[] = [];
    BLENDER_ICO.forEach((a, i) =>
      BLENDER_ICO.forEach((b, j) =>
        BLENDER_ICO.forEach((c, k) => {
          const near = (p: Vec3, q: Vec3) => distance(p, q) < edge * 1.01;
          if (i < j && j < k && near(a, b) && near(b, c) && near(a, c)) {
            const sum: Vec3 = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
            faces.push({
              value: faces.length + 1,
              normal: [sum[0] / length3(sum), sum[1] / length3(sum), sum[2] / length3(sum)],
            });
          }
        }),
      ),
    );
    expect(faces).toHaveLength(20);
    const { body } = modelBody({ points: BLENDER_ICO, faces }, d20);
    expect(body.symmetries).toHaveLength(60);
    expect(symmetryError(body).hull).toBeLessThan(1e-6);
    expect(normalShift(body, faces)).toBeLessThan(1e-3);
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

  it('takes a visual of 200,000 points, more than a call takes as arguments', () => {
    const inside = Array.from({ length: 200_000 }, (_, i): Vec3 => [
      ((i % 7) - 3) / 1000,
      ((i % 11) - 5) / 1000,
      ((i % 13) - 6) / 1000,
    ]);
    const { body } = modelBody({ points: [...CUBE, ...inside], faces: AXIS_FACES }, D6);
    expect(body.symmetries).toHaveLength(24);
  });

  it('rejects a smooth visual of 60,000 points for its corners without grouping every side', () => {
    // Points spread evenly over a sphere by the golden angle.
    const sphere = Array.from({ length: 60_000 }, (_, i): Vec3 => {
      const y = 1 - (2 * i + 1) / 60_000;
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const r = Math.sqrt(1 - y * y) / 100;
      return [r * Math.cos(angle), y / 100, r * Math.sin(angle)];
    });
    expect(() => modelBody({ points: sphere, faces: AXIS_FACES }, D6)).toThrow(
      'The model has more than 256 corners',
    );
  });

  it('merges points closer than 1e-5 of the reach: a cube with each corner given three times', () => {
    const tripled = CUBE.flatMap((p) =>
      [-1e-9, 0, 1e-9].map((d): Vec3 => [p[0] + d, p[1] - d, p[2]]),
    );
    const { body } = modelBody({ points: tripled, faces: AXIS_FACES }, D6);
    expect(body.hull).toHaveLength(8 * 3);
    expect(body.symmetries).toHaveLength(24);
  });

  it('rejects a d4 whose normals point at its truncated tips, as after a skipped Z-up turn', () => {
    for (const sign of [1, -1]) {
      const faces = D4.faces.map((face) => ({
        value: face.value,
        normal: quarterX(face.normal, sign),
      }));
      expect(() => modelBody({ points: asModel(D4).points, faces }, D4)).toThrow(
        /With \d up the model tips off the side it rests on at less than 5° of tilt/,
      );
    }
  });

  it.each(ITEMS.filter(([name]) => name !== 'd6' && name !== 'd8'))(
    'rejects the %s with normals turned a quarter about x either way',
    (_, template) => {
      for (const sign of [1, -1]) {
        const faces = template.faces.map((face) => ({
          value: face.value,
          normal: quarterX(face.normal, sign),
        }));
        expect(() => modelBody({ points: asModel(template).points, faces }, template)).toThrow(
          RangeError,
        );
      }
    },
  );

  it.each([D6, D8])(
    'accepts a d6 or d8 with normals turned a quarter about x: still its own',
    (template) => {
      const faces = template.faces.map((face) => ({
        value: face.value,
        normal: quarterX(face.normal, 1),
      }));
      expect(() => modelBody({ points: asModel(template).points, faces }, template)).not.toThrow();
    },
  );

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
      'a normal 5e-4 longer than unit, which aligning would hide',
      { points: CUBE, faces: withFace(0, { value: 1, normal: [1.0005, 0, 0] }) },
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
      /The face normals do not follow the symmetries of the corners to 1e-3/,
    ],
    [
      'an octahedron whose tips are low pyramids, 9e-4 of the reach high and 0.03 across',
      { points: octahedron(0.03, 9e-4), faces: AXIS_FACES },
      /tips off the side it rests on at less than 5° of tilt/,
    ],
    [
      'an octahedron whose tips are cut flat, 0.035 of the reach across',
      { points: octahedron(0.035, 0), faces: AXIS_FACES },
      /tips off the side it rests on at less than 5° of tilt/,
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
      /No rotation of the model carries the face of 1 onto/,
    ],
    [
      'a corner off by 8.7e-4 of the reach, which some symmetries match and others do not',
      { points: [[0.010015, 0.01, 0.01], ...CUBE.slice(0, 7)], faces: AXIS_FACES },
      /too far off their symmetric places/,
    ],
    [
      'a cube with corners cut 1e-3 of the reach deep, 1.4e-3 apart, closer than 2e-3',
      {
        points: CUBE.flatMap(([x, y, z]): Vec3[] => {
          const depth = 1e-3 * Math.hypot(x, y, z);
          return [
            [x - Math.sign(x) * depth, y, z],
            [x, y - Math.sign(y) * depth, z],
            [x, y, z - Math.sign(z) * depth],
          ];
        }),
        faces: AXIS_FACES,
      },
      /corners closer together than 2e-3 of its size/,
    ],
    [
      'a collider whose origin is off the center',
      { points: CUBE.map((p): Vec3 => [p[0] + 0.005, p[1], p[2]]), faces: AXIS_FACES },
      /No rotation of the model carries the face of 1 onto/,
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
