export type Vec3 = readonly [x: number, y: number, z: number];

export interface CameraParams {
  /** Vertical field of view in degrees, as THREE.PerspectiveCamera expects. */
  fov: number;
  position: Vec3;
  lookAt: Vec3;
}

/** Table area that must stay fully visible; centered at origin, depth runs along Z. */
export const PLAY_ZONE = { width: 4, depth: 6 } as const;

/** World-unit margin kept between the play zone and the screen edge. */
export const PADDING = 0.25;

export const DEFAULT_ASPECT = 9 / 16;

const FOV_DEG = 40;
const TILT_DEG = 50;

const DEG = Math.PI / 180;

/**
 * Camera sits on the +Z side, looking down at the table at TILT_DEG from horizontal.
 * The near zone edge lands on the bottom of the view and the far edge on the top; if the
 * zone is too wide for the aspect, the camera backs off along its view axis.
 */
export function computeCameraParams(aspect: number): CameraParams {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;

  const tilt = TILT_DEG * DEG;
  const halfFov = (FOV_DEG * DEG) / 2;
  const halfWidth = PLAY_ZONE.width / 2 + PADDING;
  const halfDepth = PLAY_ZONE.depth / 2 + PADDING;

  const steepRay = tilt + halfFov;
  const shallowRay = tilt - halfFov;
  const height = (2 * halfDepth) / (1 / Math.tan(shallowRay) - 1 / Math.tan(steepRay));
  const footZ = halfDepth + height / Math.tan(steepRay);

  // Near edge has the smallest view-axis depth, so it is the first to clip at the sides.
  const nearEdgeDepth = (height / Math.sin(steepRay)) * Math.cos(halfFov);
  const tanHalfHorizontal = Math.tan(halfFov) * safeAspect;
  const backOff = Math.max(0, halfWidth / tanHalfHorizontal - nearEdgeDepth);

  const y = height + backOff * Math.sin(tilt);
  const z = footZ + backOff * Math.cos(tilt);

  return {
    fov: FOV_DEG,
    position: [0, y, z],
    lookAt: [0, 0, z - y / Math.tan(tilt)],
  };
}
