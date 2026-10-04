import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { computeCameraParams, DEFAULT_ASPECT, PLAY_ZONE, type CameraParams } from './camera';

function buildCamera(params: CameraParams, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(params.fov, aspect, 0.1, 1000);
  camera.position.set(...params.position);
  camera.lookAt(...params.lookAt);
  camera.updateMatrixWorld();
  return camera;
}

function zoneCornersInNdc(aspect: number): Vector3[] {
  const camera = buildCamera(computeCameraParams(aspect), aspect);
  const x = PLAY_ZONE.width / 2;
  const z = PLAY_ZONE.depth / 2;
  return [
    [-x, -z],
    [x, -z],
    [-x, z],
    [x, z],
  ].map(([cx, cz]) => new Vector3(cx, 0, cz).project(camera));
}

const ASPECTS = {
  'portrait phone 9:19.5': 9 / 19.5,
  'square 1:1': 1,
  'landscape 16:9': 16 / 9,
  'very narrow 1:10': 0.1,
  'very wide 10:1': 10,
};

describe('computeCameraParams', () => {
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    it(`keeps every play zone corner inside the view on ${name}`, () => {
      for (const ndc of zoneCornersInNdc(aspect)) {
        expect(Math.abs(ndc.x)).toBeLessThan(1);
        expect(Math.abs(ndc.y)).toBeLessThan(1);
        // NDC z within [-1, 1] means the corner is between the near and far planes.
        expect(Math.abs(ndc.z)).toBeLessThan(1);
      }
    });

    it(`makes the play zone fill most of one screen axis on ${name}`, () => {
      const corners = zoneCornersInNdc(aspect);
      const reachX = Math.max(...corners.map((c) => Math.abs(c.x)));
      const reachY = Math.max(...corners.map((c) => Math.abs(c.y)));
      expect(Math.max(reachX, reachY)).toBeGreaterThan(0.8);
    });
  }

  it('places the far zone edge higher on screen than the near edge', () => {
    const [farLeft, , nearLeft] = zoneCornersInNdc(1);
    expect(farLeft!.y).toBeGreaterThan(nearLeft!.y);
  });

  it('looks down at a point on the table from above the viewer side', () => {
    const { position, lookAt } = computeCameraParams(1);
    expect(lookAt[1]).toBe(0);
    expect(position[1]).toBeGreaterThan(0);
    expect(position[2]).toBeGreaterThan(lookAt[2]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0, -1.5])(
    'falls back to the default aspect for aspect %s',
    (aspect) => {
      const params = computeCameraParams(aspect);
      expect(params).toEqual(computeCameraParams(DEFAULT_ASPECT));
      expect([params.fov, ...params.position, ...params.lookAt].every(Number.isFinite)).toBe(true);
    },
  );
});
