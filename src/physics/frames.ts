import { normalize, type Pose } from '../math/quat';

export const STEP_S = 1 / 60;
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
