import { beforeAll, describe, expect, it } from 'vitest';
import { COIN_BODY } from '../coin/coinSpec';
import { createDie, DIE_KINDS } from '../dice/dieSpec';
import { fromTo, length3, rotate, type Vec3 } from '../math/quat';
import { rotationGroup } from '../math/symmetry';
import { initPhysics, simulateToss } from '../physics/simulate';
import { bodyReach, defineBody, hullVectors, type TossBody } from '../toss/body';
import type { Face } from '../toss/faces';
import { precomputeFallback } from '../toss/planToss';
import { modelBody } from './modelBody';

const ITEMS: [string, TossBody<string>][] = [
  ['coin', COIN_BODY],
  ...DIE_KINDS.map((kind): [string, TossBody<string>] => [kind, createDie(kind).body]),
];
const D6 = createDie('d6').body;
const D4 = createDie('d4').body;

/** A body `defineBody` accepts with the first face up, without the rest check of `modelBody`. */
function unchecked(points: Vec3[], faces: Face<string>[], template: TossBody<string>) {
  const scale = bodyReach(template.hull) / Math.max(...points.map(length3));
  const hull = new Float32Array(points.flatMap((p) => p.map((v) => v * scale)));
  const vectors = hullVectors(hull);
  const quaternion = fromTo(faces[0]!.normal, [0, 1, 0]);
  const lowest = Math.min(...vectors.map((p) => rotate(quaternion, p)[1]));
  return defineBody({
    hull,
    density: template.density,
    faces,
    symmetries: rotationGroup(vectors, 1e-6),
    clearance: template.clearance,
    initialPose: { position: [0, -lowest, 0], quaternion },
    launch: { ...template.launch, touchdown: { flat: -lowest, edge: 0 } },
  });
}

beforeAll(initPhysics);

describe('a model body in the physics', () => {
  it.each(ITEMS)('records the fallback tosses of the %s as a model', (_, template) => {
    const points = hullVectors(template.hull).map((p): Vec3 => [
      p[0] / 100,
      p[1] / 100,
      p[2] / 100,
    ]);
    const { body } = modelBody({ points, faces: template.faces }, template);
    for (const reducedMotion of [false, true]) {
      expect(() => precomputeFallback(body, simulateToss, reducedMotion)).not.toThrow();
    }
  });

  it('records the fallback toss of a coin sheared with its center of mass above its base', () => {
    const points = hullVectors(COIN_BODY.hull).map((p): Vec3 => [p[0] + 4 * p[1], p[1], p[2]]);
    const { body } = modelBody({ points, faces: COIN_BODY.faces }, COIN_BODY);
    expect(() => precomputeFallback(body, simulateToss, false)).not.toThrow();
  });

  it.each([
    [
      'an octahedron with the faces of a cube',
      unchecked(
        [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ],
        D6.faces.map((face) => {
          const [x, y, z] = face.normal;
          return { ...face, normal: [Math.round(x), Math.round(y), Math.round(z)] };
        }),
        D6,
      ),
    ],
    [
      'a d4 whose normals point at its truncated tips',
      unchecked(
        hullVectors(D4.hull),
        D4.faces.map((face) => {
          const [x, y, z] = face.normal;
          return { ...face, normal: [x, -z, y] };
        }),
        D4,
      ),
    ],
    [
      'a coin sheared until its center of mass is beyond its base',
      unchecked(
        hullVectors(COIN_BODY.hull).map((p): Vec3 => [p[0] + 12 * p[1], p[1], p[2]]),
        [...COIN_BODY.faces],
        COIN_BODY,
      ),
    ],
  ])('fails to record a fallback toss for %s, which the rest check rejects', (_, body) => {
    expect(() => precomputeFallback(body, simulateToss, false)).toThrow(
      'No fallback toss came to rest flat',
    );
  });
});
