import { fromAxisAngle, IDENTITY, type Pose, type Quat, type Vec3 } from '../math/quat';
import type { Face } from '../toss/faces';
import type { TossBody } from '../toss/planToss';

// Local frame: heads face +Y, tails face -Y, origin at the center of mass.
// Octagon vertices sit at 22.5° + k·45° in the XZ plane, so a flat side faces +Z (the viewer)
// and a half-turn about X maps the outline onto itself.

/** Distance between opposite flat sides. */
export const ACROSS_FLATS = 1.2;
/** Full thickness, rim top to rim top. */
export const THICKNESS = 0.14;

export const APOTHEM = ACROSS_FLATS / 2;
/** Half-height of the straight outer side band. */
export const SIDE_HALF_HEIGHT = 0.02;
/** Height of the flat face (slab cap) above the center. */
export const FACE_HEIGHT = 0.04;
/** The rim is the highest relief, so the coin rests on its rims. */
export const RIM_OUTER_APOTHEM = 0.555;
export const RIM_INNER_APOTHEM = 0.49;
export const CIRCUMRADIUS = APOTHEM / Math.cos(Math.PI / 8);

export const DENSITY = 1;

export type CoinValue = 'heads' | 'tails';

export const COIN_FACES: readonly Face<CoinValue>[] = [
  { value: 'heads', normal: [0, 1, 0] },
  { value: 'tails', normal: [0, -1, 0] },
];

/** Vertex angles of the octagon in the XZ plane, measured from +X toward +Z. */
export function octagonAngles(): number[] {
  return Array.from({ length: 8 }, (_, k) => Math.PI / 8 + (k * Math.PI) / 4);
}

function ring(apothem: number, y: number): number[] {
  const radius = apothem / Math.cos(Math.PI / 8);
  return octagonAngles().flatMap((a) => [radius * Math.cos(a), y, radius * Math.sin(a)]);
}

/** Convex hull points of the coin without the face relief: outer side band plus rim tops. */
export function hullPoints(): Float32Array {
  const top = THICKNESS / 2;
  return new Float32Array([
    ...ring(APOTHEM, SIDE_HALF_HEIGHT),
    ...ring(APOTHEM, -SIDE_HALF_HEIGHT),
    ...ring(RIM_OUTER_APOTHEM, top),
    ...ring(RIM_OUTER_APOTHEM, -top),
  ]);
}

/**
 * Rotation group of the octagonal prism: 8 turns about Y and 8 half-turns about horizontal
 * axes at k·22.5°. Identity first, then the half-turn about X.
 */
export const COIN_SYMMETRIES: readonly Quat[] = [
  IDENTITY,
  ...Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 8;
    const axis: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    return fromAxisAngle(axis, Math.PI);
  }),
  ...Array.from({ length: 7 }, (_, k) => fromAxisAngle([0, 1, 0], ((k + 1) * Math.PI) / 4)),
];

export const COIN_BODY: TossBody<CoinValue> = {
  hull: hullPoints(),
  density: DENSITY,
  faces: COIN_FACES,
  symmetries: COIN_SYMMETRIES,
  clearance: Math.hypot(CIRCUMRADIUS, THICKNESS / 2) + 0.01,
};

/** Heads up, a little toward the viewer from the zone center. */
export const INITIAL_POSE: Pose = { position: [0, THICKNESS / 2, 1], quaternion: IDENTITY };
