import { cross, dot3, length3, rotate, type Quat, type Vec3 } from './quat';

function scaled(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Right-handed orthonormal frame with the first axis along `a` and the second in the (a, b) plane. */
function frame(a: Vec3, b: Vec3): [Vec3, Vec3, Vec3] {
  const e1 = scaled(a, 1 / length3(a));
  const along = sub(b, scaled(e1, dot3(b, e1)));
  const e2 = scaled(along, 1 / length3(along));
  return [e1, e2, cross(e1, e2)];
}

/** Rotation taking the frame of (a1, a2) onto the frame of (b1, b2). */
function frameRotation(a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3): Quat {
  const e = frame(a1, a2);
  const f = frame(b1, b2);
  const m = (i: number, j: number) => e.reduce((sum, ek, k) => sum + f[k]![i]! * ek[j]!, 0);
  const trace = m(0, 0) + m(1, 1) + m(2, 2);
  let q: Quat;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    q = [(m(2, 1) - m(1, 2)) / s, (m(0, 2) - m(2, 0)) / s, (m(1, 0) - m(0, 1)) / s, s / 4];
  } else if (m(0, 0) > m(1, 1) && m(0, 0) > m(2, 2)) {
    const s = 2 * Math.sqrt(1 + m(0, 0) - m(1, 1) - m(2, 2));
    q = [s / 4, (m(0, 1) + m(1, 0)) / s, (m(0, 2) + m(2, 0)) / s, (m(2, 1) - m(1, 2)) / s];
  } else if (m(1, 1) > m(2, 2)) {
    const s = 2 * Math.sqrt(1 + m(1, 1) - m(0, 0) - m(2, 2));
    q = [(m(0, 1) + m(1, 0)) / s, s / 4, (m(1, 2) + m(2, 1)) / s, (m(0, 2) - m(2, 0)) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m(2, 2) - m(0, 0) - m(1, 1));
    q = [(m(0, 2) + m(2, 0)) / s, (m(1, 2) + m(2, 1)) / s, s / 4, (m(1, 0) - m(0, 1)) / s];
  }
  return q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
}

/** True if rotating every point by `q` lands within `tolerance` of some point of the set. */
export function mapsOntoItself(points: readonly Vec3[], q: Quat, tolerance: number): boolean {
  return points.every((p) => {
    const r = rotate(q, p);
    return points.some((s) => length3(sub(r, s)) <= tolerance);
  });
}

function sameRotation(a: Quat, b: Quat): boolean {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 1 - 1e-9;
}

/**
 * Every rotation about the origin that maps the point set onto itself, identity first.
 * A rotation of a finite set is fixed by where it sends two non-collinear points, so only
 * rotations taking a reference pair onto another pair with the same lengths and angle are tried.
 * `tolerance` is relative to the largest point distance from the origin.
 */
export function rotationGroup(points: readonly Vec3[], tolerance = 1e-6): Quat[] {
  if (points.length < 2) throw new RangeError('rotationGroup needs at least two points');
  if (!points.every((p) => p.every(Number.isFinite))) {
    throw new RangeError('rotationGroup needs finite points');
  }
  const p0 = points.reduce((best, p) => (length3(p) > length3(best) ? p : best));
  const scale = length3(p0);
  const tol = tolerance * Math.max(scale, 1e-12);
  const p1 = points.reduce((best, p) =>
    length3(cross(p0, p)) > length3(cross(p0, best)) ? p : best,
  );
  // A set on one line through the origin has a continuous symmetry group.
  if (scale < tol || length3(cross(p0, p1)) <= tol * scale) {
    throw new RangeError('rotationGroup needs points that span more than one line');
  }

  const group: Quat[] = [];
  for (const a of points) {
    if (Math.abs(length3(a) - scale) > tol) continue;
    for (const b of points) {
      if (Math.abs(length3(b) - length3(p1)) > tol) continue;
      if (Math.abs(dot3(a, b) - dot3(p0, p1)) > tol * scale) continue;
      const q = frameRotation(p0, p1, a, b);
      if (group.some((g) => sameRotation(g, q))) continue;
      if (mapsOntoItself(points, q, tol)) group.push(q);
    }
  }
  return group.sort((x, y) => y[3] - x[3]);
}
