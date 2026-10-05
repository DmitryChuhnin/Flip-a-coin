import { normalize, type Pose } from '../math/quat';
import { PADDING, PLAY_ZONE } from '../scene/camera';

export const STEP_S = 1 / 60;

// World units are about 2 cm. Real gravity at this scale throws the coin out of frame, so
// gravity is tuned for a ~3-unit apex and a ~1 s flight instead. Kept here, outside the Rapier
// module, with the walls, because the main chunk uses both.
export const GRAVITY = 20;
/** Inner wall faces: the play zone plus the margin the camera keeps visible. */
export const WALL_INNER = {
  x: PLAY_ZONE.width / 2 + PADDING,
  z: PLAY_ZONE.depth / 2 + PADDING,
} as const;
/** Values per frame: x, y, z, qx, qy, qz, qw. */
export const FRAME_STRIDE = 7;

export function framePose(frames: Float32Array, index: number): Pose {
  const o = index * FRAME_STRIDE;
  return {
    position: [frames[o]!, frames[o + 1]!, frames[o + 2]!],
    quaternion: normalize([frames[o + 3]!, frames[o + 4]!, frames[o + 5]!, frames[o + 6]!]),
  };
}

export function frameCount(frames: Float32Array): number {
  return Math.floor(frames.length / FRAME_STRIDE);
}

export function durationS(frames: Float32Array): number {
  return Math.max(0, frameCount(frames) - 1) * STEP_S;
}

/** Visible motion below this counts as rest: about 0.1 mm and half a degree. */
const STILL_DISTANCE = 0.005;
const STILL_COS_HALF_ANGLE = Math.cos((0.5 * Math.PI) / 180 / 2);

/** When the body last moved visibly: every later frame stays at its final pose. */
export function stillSinceS(frames: Float32Array): number {
  const count = frameCount(frames);
  if (count === 0) return 0;
  const end = framePose(frames, count - 1);
  let first = count - 1;
  while (first > 0) {
    const { position: p, quaternion: q } = framePose(frames, first - 1);
    const distance = Math.hypot(
      p[0] - end.position[0],
      p[1] - end.position[1],
      p[2] - end.position[2],
    );
    const dot = Math.abs(
      q[0] * end.quaternion[0] +
        q[1] * end.quaternion[1] +
        q[2] * end.quaternion[2] +
        q[3] * end.quaternion[3],
    );
    if (distance > STILL_DISTANCE || dot < STILL_COS_HALF_ANGLE) break;
    first -= 1;
  }
  return first * STEP_S;
}
