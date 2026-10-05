import { fromAxisAngle, fromTo, multiply, rotate, type Pose, type Quat } from '../math/quat';
import { frameCount, framePose, WALL_INNER } from '../physics/frames';
import { hullVectors, type TossBody } from '../toss/body';

const LEAN_RAD = (9 * Math.PI) / 180;

function extent<V extends string>(body: TossBody<V>, q: Quat, axis: 0 | 2): number {
  return Math.max(...hullVectors(body.hull).map((p) => Math.abs(rotate(q, p)[axis])));
}

/** Rest poses leaning 9° with the hull touching each side wall and corner, over several yaws and faces. */
export function wallStarts<V extends string>(body: TossBody<V>, yaws = 8): Pose[] {
  const starts: Pose[] = [];
  for (const [sx, sz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
  ] as const) {
    for (let step = 0; step < yaws; step += 1) {
      const face = body.faces[step % body.faces.length]!;
      const quaternion = multiply(
        fromAxisAngle([Math.cos(step), 0, Math.sin(step)], LEAN_RAD),
        multiply(
          fromAxisAngle([0, 1, 0], (step * 2 * Math.PI) / yaws),
          fromTo(face.normal, [0, 1, 0]),
        ),
      );
      const x = WALL_INNER.x - extent(body, quaternion, 0);
      const z = WALL_INNER.z - extent(body, quaternion, 2);
      starts.push({ position: [sx * x, body.initialPose.position[1], sz * z], quaternion });
    }
  }
  return starts;
}

/** How far the hull reaches past the body's side walls from frame `from` on; 0 or less is inside. */
export function wallOvershoot<V extends string>(
  frames: Float32Array,
  body: TossBody<V>,
  from: number,
): number {
  const points = hullVectors(body.hull);
  let worst = -Infinity;
  for (let i = from; i < frameCount(frames); i += 1) {
    const { position, quaternion } = framePose(frames, i);
    for (const p of points) {
      const r = rotate(quaternion, p);
      worst = Math.max(
        worst,
        Math.abs(r[0] + position[0]) - WALL_INNER.x,
        Math.abs(r[2] + position[2]) - WALL_INNER.z,
      );
    }
  }
  return worst;
}
