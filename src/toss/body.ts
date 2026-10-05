import { length3, rotate, type Pose, type Quat, type Vec3 } from '../math/quat';
import { mapsOntoItself } from '../math/symmetry';
import { buildRemapTable, upFace, type Face, type RemapTable } from './faces';
import type { Launch } from './profiles';

export interface TossBody<V extends string> {
  /** Convex hull points in the local frame, origin at the center of mass; also the collider. */
  hull: Float32Array;
  density: number;
  faces: readonly Face<V>[];
  /** Rotations mapping the hull onto itself, in the local frame. */
  symmetries: readonly Quat[];
  remaps: RemapTable;
  /** Body center height above which no orientation touches the table. */
  clearance: number;
  /** Rest pose on the table before the first toss; the fallback toss is recorded from it. */
  initialPose: Pose;
  launch: Launch;
}

const UNIT_TOLERANCE = 1e-6;
/** Hull points are float32, so symmetric points match only to about 1e-7 of the body size. */
const HULL_TOLERANCE = 1e-5;
const REST_TOLERANCE = 1e-4;

export function hullVectors(hull: Float32Array): Vec3[] {
  return Array.from({ length: hull.length / 3 }, (_, i) => [
    hull[3 * i]!,
    hull[3 * i + 1]!,
    hull[3 * i + 2]!,
  ]);
}

function isUnit(v: readonly number[]): boolean {
  return v.every(Number.isFinite) && Math.abs(Math.hypot(...v) - 1) <= UNIT_TOLERANCE;
}

/**
 * Checks a body description and builds its remap table. Every check guards a way to show a
 * wrong or missing outcome: a face no symmetry reaches, a symmetry that changes the silhouette,
 * a face direction that is not unit length, or a start pose that floats or sinks.
 */
export function defineBody<V extends string>(spec: Omit<TossBody<V>, 'remaps'>): TossBody<V> {
  const { hull, faces, symmetries } = spec;
  if (hull.length < 12 || hull.length % 3 !== 0 || !hull.every(Number.isFinite)) {
    throw new RangeError('Hull needs at least four finite points as x, y, z triples');
  }
  if (!(spec.density > 0 && Number.isFinite(spec.density))) {
    throw new RangeError(`Density must be positive, got ${spec.density}`);
  }
  if (faces.length < 2) throw new RangeError('A body needs at least two faces');
  if (new Set(faces.map((f) => f.value)).size !== faces.length) {
    throw new RangeError('Face values must be distinct');
  }
  faces.forEach((face, i) => {
    if (!isUnit(face.normal)) throw new RangeError(`Face ${i} direction is not a unit vector`);
  });
  if (symmetries.length === 0 || !symmetries.every(isUnit)) {
    throw new RangeError('Symmetries must be a non-empty list of unit quaternions');
  }

  const points = hullVectors(hull);
  const reach = Math.max(...points.map(length3));
  symmetries.forEach((q, i) => {
    if (!mapsOntoItself(points, q, HULL_TOLERANCE * reach)) {
      throw new RangeError(`Symmetry ${i} does not map the hull onto itself`);
    }
    const permutes = faces.every((face) => {
      const turned = rotate(q, face.normal);
      return faces.some((other) => length3(sub(turned, other.normal)) <= UNIT_TOLERANCE);
    });
    if (!permutes) throw new RangeError(`Symmetry ${i} does not map faces onto faces`);
  });
  if (!(spec.clearance > reach)) {
    throw new RangeError(`Clearance ${spec.clearance} does not clear the hull reach ${reach}`);
  }

  const { position, quaternion } = spec.initialPose;
  if (!isUnit(quaternion) || upFace(quaternion, faces).tiltDeg > 0.01) {
    throw new RangeError('Initial pose must rest flat with a unit quaternion');
  }
  const lowest = Math.min(...points.map((p) => rotate(quaternion, p)[1]));
  if (Math.abs(position[1] + lowest) > REST_TOLERANCE) {
    throw new RangeError('Initial pose must rest on the table');
  }

  return { ...spec, remaps: buildRemapTable(faces, symmetries) };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
