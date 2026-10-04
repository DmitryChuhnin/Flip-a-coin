import { lerp3, multiply, partialRotation, slerp, type Pose, type Quat } from '../math/quat';
import { frameCount, framePose, STEP_S } from '../physics/frames';
import type { BlendWindow } from './planToss';

/** Longest step the playback clock takes, so a stalled or hidden tab resumes where it stopped. */
export const MAX_FRAME_STEP_S = 0.1;

/** Body pose at time `t`, interpolated between simulation steps and clamped to the ends. */
export function bodyPose(frames: Float32Array, t: number): Pose {
  const last = frameCount(frames) - 1;
  if (last < 0) throw new RangeError('No frames to play');
  const position = Number.isFinite(t) ? Math.min(Math.max(t / STEP_S, 0), last) : 0;
  const i = Math.min(Math.floor(position), Math.max(0, last - 1));
  const a = framePose(frames, i);
  if (last === 0) return a;
  const b = framePose(frames, i + 1);
  const f = position - i;
  return {
    position: lerp3(a.position, b.position, f),
    quaternion: slerp(a.quaternion, b.quaternion, f),
  };
}

/** Smoothstep from 0 at the window start to 1 at its end. */
export function blendProgress(window: BlendWindow, t: number): number {
  if (t >= window.endS) return 1;
  if (t <= window.startS) return 0;
  const p = (t - window.startS) / (window.endS - window.startS);
  return p * p * (3 - 2 * p);
}

export interface Playable {
  frames: Float32Array;
  visualOffset: Quat;
  blend: BlendWindow;
}

/** Pose to draw: the body pose turned by the share of the visual offset reached at `t`. */
export function visualPose(plan: Playable, t: number): Pose {
  const body = bodyPose(plan.frames, t);
  const offset = partialRotation(plan.visualOffset, blendProgress(plan.blend, t));
  return { position: body.position, quaternion: multiply(body.quaternion, offset) };
}

export class FrameClock {
  private last: number | null = null;

  constructor(private readonly maxStepS = MAX_FRAME_STEP_S) {}

  /** Seconds since the previous tick, at most `maxStepS`; 0 on the first tick after a reset. */
  tick(nowMs: number): number {
    const last = this.last;
    this.last = nowMs;
    if (last === null || !Number.isFinite(nowMs) || nowMs <= last) return 0;
    return Math.min((nowMs - last) / 1000, this.maxStepS);
  }

  reset(): void {
    this.last = null;
  }
}
