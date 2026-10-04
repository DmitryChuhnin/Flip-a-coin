import { normalize, type Pose } from '../math/quat';

export const STEP_S = 1 / 60;

// World units are about 2 cm. Real gravity at this scale throws the coin out of frame, so
// gravity is tuned for a ~3-unit apex and a ~1 s flight instead. Kept here, outside the Rapier
// module, because launch profiles in the main chunk use it.
export const GRAVITY = 20;
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
