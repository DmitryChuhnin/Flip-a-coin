import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { computeCameraParams, DEFAULT_ASPECT, flightBox, type CameraParams } from './camera';

function buildCamera(params: CameraParams, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(params.fov, aspect, 0.1, 1000);
  camera.position.set(...params.position);
  camera.lookAt(...params.lookAt);
  camera.updateMatrixWorld();
  return camera;
}

/** Flight box corners projected to NDC. */
function boxInNdc(aspect: number): Vector3[] {
  const camera = buildCamera(computeCameraParams(aspect), aspect);
  return flightBox().map((p) => new Vector3(...p).project(camera));
}

const WIDTH_BOUND = {
  'portrait phone 9:19.5': 9 / 19.5,
  'portrait 9:16': 9 / 16,
  'very narrow 1:10': 0.1,
  'square 1:1': 1,
};

const HEIGHT_BOUND = {
  'landscape 16:9': 16 / 9,
  'very wide 10:1': 10,
};

describe('computeCameraParams', () => {
  for (const [name, aspect] of Object.entries({ ...WIDTH_BOUND, ...HEIGHT_BOUND })) {
    it(`keeps every flight box corner inside the view on ${name}`, () => {
      for (const ndc of boxInNdc(aspect)) {
        expect(Math.abs(ndc.x)).toBeLessThan(1 + 1e-9);
        expect(Math.abs(ndc.y)).toBeLessThan(1 + 1e-9);
        // NDC z within [-1, 1] means the corner is between the near and far planes.
        expect(Math.abs(ndc.z)).toBeLessThan(1);
      }
    });

    it(`sets the box on the bottom edge on ${name}`, () => {
      const bottom = Math.min(...boxInNdc(aspect).map((ndc) => ndc.y));
      expect(bottom).toBeCloseTo(-1, 6);
    });
  }

  for (const [name, aspect] of Object.entries(WIDTH_BOUND)) {
    it(`fits the box to the screen sides and leaves room above it on ${name}`, () => {
      const ndc = boxInNdc(aspect);
      expect(Math.max(...ndc.map((p) => Math.abs(p.x)))).toBeCloseTo(1, 6);
      expect(Math.max(...ndc.map((p) => p.y))).toBeLessThan(1 - 1e-3);
    });
  }

  for (const [name, aspect] of Object.entries(HEIGHT_BOUND)) {
    it(`fits the box to the screen top and bottom on ${name}`, () => {
      const ndc = boxInNdc(aspect);
      expect(Math.max(...ndc.map((p) => p.y))).toBeCloseTo(1, 6);
      expect(Math.max(...ndc.map((p) => Math.abs(p.x)))).toBeLessThan(1 + 1e-9);
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
