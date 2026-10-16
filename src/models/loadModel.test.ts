import { describe, expect, it } from 'vitest';
import { COIN_BODY } from '../coin/coinSpec';
import { createDie } from '../dice/dieSpec';
import { dot3, type Vec3 } from '../math/quat';
import { buildGlb } from '../testing/glb';
import { hullVectors } from '../toss/body';
import { loadModel } from './loadModel';

const D8 = createDie('d8').body;
/** The d8 hull in meters, as a file made from it would carry it. */
const POINTS = hullVectors(D8.hull).map((p): Vec3 => [p[0] / 100, p[1] / 100, p[2] / 100]);
const FACES = D8.faces.map((face) => ({ value: Number(face.value), normal: [...face.normal] }));
const values = (faces: readonly { value: string }[]) => faces.map((face) => face.value);

describe('loadModel', () => {
  it('builds the body from the collider and draws only the visual, scaled to game units', async () => {
    const data = buildGlb([
      { name: 'visual', points: POINTS },
      { name: 'collider', points: POINTS, extras: { faces: FACES } },
    ]);
    const { visual, body } = await loadModel(data, D8);
    expect(values(body.faces)).toEqual(values(D8.faces));
    expect(body.symmetries).toHaveLength(D8.symmetries.length);
    expect(visual.scale.x).toBeCloseTo(100, 3);
    expect(visual.getObjectByName('visual')).toBeDefined();
    expect(visual.getObjectByName('collider')).toBeUndefined();
  });

  it('reads faces from the scene as a JSON string', async () => {
    const data = buildGlb(
      [
        { name: 'visual', points: POINTS },
        { name: 'collider', points: POINTS },
      ],
      { faces: JSON.stringify(FACES) },
    );
    expect(values((await loadModel(data, D8)).body.faces)).toEqual(values(D8.faces));
  });

  it('prefers the scene faces to those on a node', async () => {
    const wrong = FACES.map((face) => ({ ...face, value: 9 }));
    const data = buildGlb(
      [
        { name: 'visual', points: POINTS, extras: { faces: wrong } },
        { name: 'collider', points: POINTS, extras: { faces: wrong } },
      ],
      { faces: FACES },
    );
    expect(values((await loadModel(data, D8)).body.faces)).toEqual(values(D8.faces));
  });

  it('reads faces from the collider before the visual', async () => {
    const wrong = FACES.map((face) => ({ ...face, value: 9 }));
    const data = buildGlb([
      { name: 'visual', points: POINTS, extras: { faces: wrong } },
      { name: 'collider', points: POINTS, extras: { faces: FACES } },
    ]);
    expect(values((await loadModel(data, D8)).body.faces)).toEqual(values(D8.faces));
  });

  it('takes only the corners of a visual with points inside its sides', async () => {
    // On one side, a third of the way from its center to each corner, 2e-8 m out of its plane.
    const [nx, ny, nz] = D8.faces[0]!.normal;
    const height = Math.max(...POINTS.map((p) => dot3(p, [nx, ny, nz])));
    const side = POINTS.filter((p) => height - dot3(p, [nx, ny, nz]) < 1e-9);
    expect(side).toHaveLength(3);
    const [cx, cy, cz] = [0, 1, 2].map((axis) => side.reduce((sum, p) => sum + p[axis]! / 3, 0));
    const marks = side.map((p): Vec3 => [
      (2 * cx! + p[0]) / 3 + 2e-8 * nx,
      (2 * cy! + p[1]) / 3 + 2e-8 * ny,
      (2 * cz! + p[2]) / 3 + 2e-8 * nz,
    ]);
    const data = buildGlb([
      { name: 'visual', points: [...POINTS, ...marks], extras: { faces: FACES } },
    ]);
    const { body } = await loadModel(data, D8);
    expect(body.hull).toHaveLength(D8.hull.length);
    expect(body.symmetries).toHaveLength(D8.symmetries.length);
  });

  it('takes the hull of the visual without a collider, ignoring points inside it', async () => {
    const inside: Vec3[] = [
      [0, 0, 0],
      [0.001, -0.002, 0.003],
    ];
    const data = buildGlb([
      { name: 'visual', points: [...inside, ...POINTS], extras: { faces: FACES } },
    ]);
    const { body } = await loadModel(data, D8);
    expect(body.hull).toHaveLength(D8.hull.length);
    expect(body.symmetries).toHaveLength(D8.symmetries.length);
  });

  it('applies node transforms, including a parent of the visual and a collider in it', async () => {
    const doubled = POINTS.map((p): Vec3 => [p[0] * 2, p[1] * 2, p[2] * 2]);
    const data = buildGlb(
      [
        {
          name: 'model',
          scale: [2, 2, 2],
          children: [
            {
              name: 'visual',
              points: POINTS,
              scale: [1.5, 1.5, 1.5],
              children: [{ name: 'collider', points: doubled, scale: [1 / 6, 1 / 6, 1 / 6] }],
            },
          ],
        },
      ],
      { faces: FACES },
    );
    const { visual, body } = await loadModel(data, D8);
    expect(Array.from(body.hull)).toHaveLength(D8.hull.length);
    expect(visual.scale.x).toBeCloseTo(100, 3);
    expect(visual.getObjectByName('visual')!.scale.x).toBeCloseTo(3, 6);
    expect(visual.getObjectByName('collider')).toBeUndefined();
  });

  it('accepts a coin with heads and tails', async () => {
    const coin = hullVectors(COIN_BODY.hull);
    const faces = COIN_BODY.faces.map((face) => ({ value: face.value, normal: [...face.normal] }));
    const data = buildGlb([{ name: 'visual', points: coin, extras: { faces } }]);
    expect(values((await loadModel(data, COIN_BODY)).body.faces)).toEqual(['heads', 'tails']);
  });

  it('rejects a file without a visual node with a RangeError', async () => {
    const data = buildGlb([{ name: 'collider', points: POINTS, extras: { faces: FACES } }]);
    await expect(loadModel(data, D8)).rejects.toThrow(RangeError);
    await expect(loadModel(data, D8)).rejects.toThrow(/no node named visual/);
  });

  it('rejects a model without faces with a RangeError', async () => {
    const data = buildGlb([{ name: 'visual', points: POINTS }]);
    await expect(loadModel(data, D8)).rejects.toThrow(RangeError);
    await expect(loadModel(data, D8)).rejects.toThrow(/no faces property/);
  });

  it('rejects a collider on one line with a RangeError, not a hull error', async () => {
    const line = [-2, -1, 1, 2, 3].map((t): Vec3 => [t / 100, 0, 0]);
    const data = buildGlb([
      { name: 'visual', points: POINTS },
      { name: 'collider', points: line, extras: { faces: FACES } },
    ]);
    await expect(loadModel(data, D8)).rejects.toThrow(RangeError);
    await expect(loadModel(data, D8)).rejects.toThrow(/one line/);
  });

  it('rejects a flat visual with a RangeError, not a hull error', async () => {
    const flat = POINTS.map((p): Vec3 => [p[0], 0, p[2]]);
    const data = buildGlb([{ name: 'visual', points: flat, extras: { faces: FACES } }]);
    await expect(loadModel(data, D8)).rejects.toThrow(RangeError);
  });

  it.each([
    ['bytes that are not glTF', new TextEncoder().encode('not a model').buffer],
    ['a file cut short', buildGlb([{ name: 'visual', points: POINTS }]).slice(0, -40)],
  ])('rejects %s with an Error caused by the parse, not a RangeError', async (_, data) => {
    const error: unknown = await loadModel(data, D8).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(/not a readable glTF model/);
    expect((error as Error).cause).toBeInstanceOf(Error);
  });
});
