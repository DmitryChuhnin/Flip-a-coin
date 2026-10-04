import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  computeCameraParams,
  DEFAULT_ASPECT,
  PADDING,
  PLAY_ZONE,
  type CameraParams,
} from './camera';

function buildCamera(params: CameraParams, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(params.fov, aspect, 0.1, 1000);
  camera.position.set(...params.position);
  camera.lookAt(...params.lookAt);
  camera.updateMatrixWorld();
  return camera;
}

/** Corners of the zone grown by `margin`, projected to NDC: far-left, far-right, near-left, near-right. */
function cornersInNdc(aspect: number, margin: number): Vector3[] {
  const camera = buildCamera(computeCameraParams(aspect), aspect);
  const x = PLAY_ZONE.width / 2 + margin;
  const z = PLAY_ZONE.depth / 2 + margin;
  return [
    [-x, -z],
    [x, -z],
    [-x, z],
    [x, z],
  ].map(([cx, cz]) => new Vector3(cx, 0, cz).project(camera));
}

const WIDTH_BOUND = {
  'portrait phone 9:19.5': 9 / 19.5,
  'square 1:1': 1,
  'very narrow 1:10': 0.1,
};

const HEIGHT_BOUND = {
  'landscape 16:9': 16 / 9,
  'very wide 10:1': 10,
};

describe('computeCameraParams', () => {
  for (const [name, aspect] of Object.entries({ ...WIDTH_BOUND, ...HEIGHT_BOUND })) {
    it(`keeps every play zone corner inside the view on ${name}`, () => {
      for (const ndc of cornersInNdc(aspect, 0)) {
        expect(Math.abs(ndc.x)).toBeLessThan(1);
        expect(Math.abs(ndc.y)).toBeLessThan(1);
        // NDC z within [-1, 1] means the corner is between the near and far planes.
        expect(Math.abs(ndc.z)).toBeLessThan(1);
      }
    });
  }

  for (const [name, aspect] of Object.entries(WIDTH_BOUND)) {
    it(`puts the padded near corners on the screen sides on ${name}`, () => {
      const [farLeft, farRight, nearLeft, nearRight] = cornersInNdc(aspect, PADDING);
      expect(nearLeft!.x).toBeCloseTo(-1, 6);
      expect(nearRight!.x).toBeCloseTo(1, 6);
      expect(Math.abs(farLeft!.x)).toBeLessThan(1);
      expect(Math.abs(farRight!.x)).toBeLessThan(1);
      expect(nearLeft!.y).toBeGreaterThan(-1);
      expect(farLeft!.y).toBeLessThan(1);
    });
  }

  for (const [name, aspect] of Object.entries(HEIGHT_BOUND)) {
    it(`puts the padded near and far edges on the screen bottom and top on ${name}`, () => {
      const [farLeft, farRight, nearLeft, nearRight] = cornersInNdc(aspect, PADDING);
      expect(nearLeft!.y).toBeCloseTo(-1, 6);
      expect(nearRight!.y).toBeCloseTo(-1, 6);
      expect(farLeft!.y).toBeCloseTo(1, 6);
      expect(farRight!.y).toBeCloseTo(1, 6);
      expect(Math.abs(nearLeft!.x)).toBeLessThan(1);
    });
  }

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
