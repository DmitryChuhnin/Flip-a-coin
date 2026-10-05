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
