export type Vec3 = readonly [x: number, y: number, z: number];
/** Unit quaternion in three.js component order. */
export type Quat = readonly [x: number, y: number, z: number, w: number];

export interface Pose {
  position: Vec3;
  quaternion: Quat;
}

export const IDENTITY: Quat = [0, 0, 0, 1];

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function fromAxisAngle(axis: Vec3, angle: number): Quat {
  const len = length3(axis);
  if (len === 0) return IDENTITY;
  const s = Math.sin(angle / 2) / len;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** Hamilton product: applying the result rotates by `b` first, then by `a`. */
export function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function conjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function normalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len === 0 ? IDENTITY : [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const c = cross(u, v);
  const t: Vec3 = [2 * c[0], 2 * c[1], 2 * c[2]];
  const ut = cross(u, t);
  return [v[0] + q[3] * t[0] + ut[0], v[1] + q[3] * t[1] + ut[1], v[2] + q[3] * t[2] + ut[2]];
}

/** Shortest-path spherical interpolation. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let end = b;
  if (cos < 0) {
    cos = -cos;
    end = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (cos > 0.9995) {
    return normalize([
      a[0] + (end[0] - a[0]) * t,
      a[1] + (end[1] - a[1]) * t,
      a[2] + (end[2] - a[2]) * t,
      a[3] + (end[3] - a[3]) * t,
    ]);
  }
  const theta = Math.acos(cos);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [
    a[0] * wa + end[0] * wb,
    a[1] * wa + end[1] * wb,
    a[2] * wa + end[2] * wb,
    a[3] * wa + end[3] * wb,
  ];
}

/** Rotation by fraction `t` of `q` along its own axis, keeping the sign of `q` (no shortest-path flip). */
export function partialRotation(q: Quat, t: number): Quat {
  const w = Math.min(1, Math.max(-1, q[3]));
  const angle = 2 * Math.acos(w);
  if (angle < 1e-9) return IDENTITY;
  return fromAxisAngle([q[0], q[1], q[2]], angle * t);
}
