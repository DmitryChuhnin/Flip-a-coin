export type Vec3 = readonly [x: number, y: number, z: number];

export interface CameraParams {
  /** Vertical field of view in degrees, as THREE.PerspectiveCamera expects. */
  fov: number;
  position: Vec3;
  lookAt: Vec3;
}

/** Table area that must stay fully visible; centered at origin, depth runs along Z. */
export const PLAY_ZONE = { width: 4, depth: 6 } as const;

/** World-unit margin between the play zone and the walls. */
export const PADDING = 0.25;

/**
 * Highest point any body reaches: the top of its hull at the apex of the highest launch.
 * A unit test checks it against every body's launch profiles.
 */
export const FLIGHT_CEILING = 4.2;

/** Extra room past the walls: a spinning body can cross a wall by up to 0.2 for a moment. */
export const WALL_MARGIN = 0.2;

export const DEFAULT_ASPECT = 9 / 16;

const FOV_DEG = 38;
const TILT_DEG = 30;

const DEG = Math.PI / 180;

/**
 * Close-up of a resting body, per unit of its reach: camera distance to the look point, and the
 * look point above and behind the body. On a portrait phone the coin sits in the lower third and
 * fills about half the width; on narrower screens the camera backs off to `maxWidth` of it.
 */
const CLOSE_UP = { distance: 11, lookUp: 1.03, lookBack: 1.28, maxWidth: 0.7 } as const;

function safeAspect(aspect: number): number {
  return Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;
}

/** Corners of the box every flight stays in: the walls plus the margin, up to the ceiling. */
export function flightBox(): Vec3[] {
  const x = PLAY_ZONE.width / 2 + PADDING + WALL_MARGIN;
  const z = PLAY_ZONE.depth / 2 + PADDING + WALL_MARGIN;
  const corners: Vec3[] = [];
  for (const cx of [-x, x]) {
    for (const cz of [-z, z]) {
      for (const cy of [0, FLIGHT_CEILING]) corners.push([cx, cy, cz]);
    }
  }
  return corners;
}

/**
 * Camera at TILT_DEG from horizontal that comes as close as it can while every point stays in
 * view, `margin` of the half-screen away from the edges. Where the screen has height to spare,
 * the camera rises so the points sit on the bottom edge and the space above is left to the
 * interface.
 */
export function fitView(points: readonly Vec3[], aspect: number, margin = 0): CameraParams {
  const tilt = TILT_DEG * DEG;
  const tanV = Math.tan((FOV_DEG * DEG) / 2) * (1 - margin);
  const tanH = tanV * safeAspect(aspect);

  // Camera at a·up + b·forward; a point's depth is forward·p − b, its height in view up·p − a.
  const sin = Math.sin(tilt);
  const cos = Math.cos(tilt);
  const forward = (p: Vec3) => -p[1] * sin - p[2] * cos;
  const up = (p: Vec3) => p[1] * cos - p[2] * sin;

  // Each pair of points bounds how close the camera may come: both must fit between the left
  // and right edges, and between the bottom and top.
  let b = Infinity;
  for (const p of points) {
    for (const q of points) {
      const depths = forward(p) + forward(q);
      b = Math.min(b, (q[0] - p[0] + tanH * depths) / (2 * tanH));
      b = Math.min(b, (up(q) - up(p) + tanV * depths) / (2 * tanV));
    }
  }
  let left = -Infinity;
  let right = Infinity;
  let a = Infinity;
  for (const p of points) {
    const depth = forward(p) - b;
    left = Math.max(left, p[0] - tanH * depth);
    right = Math.min(right, p[0] + tanH * depth);
    a = Math.min(a, up(p) + tanV * depth);
  }

  const x = (left + right) / 2;
  const y = a * cos - b * sin;
  const z = -a * sin - b * cos;
  return {
    fov: FOV_DEG,
    position: [x, y, z],
    lookAt: [x, 0, z - y / Math.tan(tilt)],
  };
}

/** Wide view of the whole flight box, for any toss from anywhere on the table. */
export function computeCameraParams(aspect: number): CameraParams {
  return fitView(flightBox(), aspect);
}

/** Camera framing a body of `reach` resting at `target`, at the same tilt and field of view. */
export function closeUpParams(target: Vec3, reach: number, aspect: number): CameraParams {
  const tilt = TILT_DEG * DEG;
  const tanH = Math.tan((FOV_DEG * DEG) / 2) * safeAspect(aspect);
  const look: Vec3 = [
    target[0],
    target[1] + CLOSE_UP.lookUp * reach,
    target[2] - CLOSE_UP.lookBack * reach,
  ];
  const d = reach * Math.max(CLOSE_UP.distance, 1 / (CLOSE_UP.maxWidth * tanH));
  return {
    fov: FOV_DEG,
    position: [look[0], look[1] + d * Math.sin(tilt), look[2] + d * Math.cos(tilt)],
    lookAt: look,
  };
}
