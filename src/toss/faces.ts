import { dot3, length3, rotate, type Quat, type Vec3 } from '../math/quat';

export interface Face<V extends string = string> {
  value: V;
  /**
   * Unit vector in the body's local frame that points up when this outcome shows: the outward
   * face normal, or for a d4 the direction of the top vertex.
   */
  normal: Vec3;
}

export interface UpFace {
  index: number;
  /** Angle between the face direction and world +Y. */
  tiltDeg: number;
}

const EPSILON = 1e-6;

export function upFace(q: Quat, faces: readonly Face[]): UpFace {
  if (faces.length === 0) throw new RangeError('upFace needs at least one face');
  let index = 0;
  let best = -Infinity;
  faces.forEach((face, i) => {
    const up = rotate(q, face.normal)[1];
    if (up > best) {
      best = up;
      index = i;
    }
  });
  const tiltDeg = (Math.acos(Math.min(1, Math.max(-1, best))) * 180) / Math.PI;
  return { index, tiltDeg };
}

/** `table[landed][desired]`: every symmetry R with R·n[desired] = n[landed]. */
export type RemapTable = readonly (readonly (readonly Quat[])[])[];

/**
 * Remap candidates for every pair of faces, computed once per body. Throws if some pair has
 * none: the symmetries are not transitive on the faces, so some outcome could not be shown.
 */
export function buildRemapTable(faces: readonly Face[], symmetries: readonly Quat[]): RemapTable {
  return faces.map((landed, l) =>
    faces.map((desired, d) => {
      const candidates = symmetries.filter(
        (r) => length3(sub(rotate(r, desired.normal), landed.normal)) <= EPSILON,
      );
      if (candidates.length === 0) {
        throw new Error(`No symmetry maps face ${d} onto face ${l}`);
      }
      return candidates;
    }),
  );
}

/**
 * Symmetry R of the body's shape with R·n[desired] = n[landed]. Showing the body at
 * `pose · R` puts the desired face where the landed one is, with the same silhouette.
 * Prefers the smallest rotation, then the axis closest to `preferAxis` (local frame).
 */
export function remapRotation(
  table: RemapTable,
  landed: number,
  desired: number,
  preferAxis: Vec3 = [1, 0, 0],
): Quat {
  const candidates = table[landed]?.[desired];
  if (!candidates) {
    throw new RangeError(`No face at index ${table[landed] ? desired : landed}`);
  }

  let best = candidates[0]!;
  let bestAngle = Infinity;
  let bestAlign = -Infinity;
  for (const candidate of candidates) {
    const r = canonical(candidate, preferAxis);
    const angle = 2 * Math.acos(Math.min(1, r[3]));
    const align = Math.abs(cosine([r[0], r[1], r[2]], preferAxis));
    if (angle < bestAngle - EPSILON || (angle < bestAngle + EPSILON && align > bestAlign)) {
      best = r;
      bestAngle = angle;
      bestAlign = align;
    }
  }
  return best;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cosine(a: Vec3, b: Vec3): number {
  const lengths = length3(a) * length3(b);
  return lengths < EPSILON ? 0 : dot3(a, b) / lengths;
}

// q and -q are the same rotation. Keep w >= 0 (angle <= π); for a half-turn, point the axis
// along preferAxis so that a partial rotation turns the same way as the body spins.
function canonical(q: Quat, preferAxis: Vec3): Quat {
  const halfTurn = Math.abs(q[3]) < EPSILON;
  const negative = halfTurn ? dot3([q[0], q[1], q[2]], preferAxis) < 0 : q[3] < 0;
  return negative ? [-q[0], -q[1], -q[2], -q[3]] : q;
}
