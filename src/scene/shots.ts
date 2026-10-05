import {
  closeUpParams,
  computeCameraParams,
  fitView,
  type CameraParams,
  type Vec3,
} from './camera';
import { rotate } from '../math/quat';
import { frameCount, STEP_S } from '../physics/frames';
import { visualPose, type Playable } from '../toss/playback';

/** Camera framing for a screen aspect; recomputed every frame, so it follows a resize. */
export type View = (aspect: number) => CameraParams;

/** Camera move from one view to another; a hold has the same view at both ends. */
export interface Shot {
  from: View;
  to: View;
  startS: number;
  durationS: number;
}

/** Move from the close-up to the flight view, starting with the launch. */
export const LAUNCH_SHOT_S = 0.35;
/** Move from the flight view to the close-up on the landed body. */
export const SETTLE_SHOT_S = 0.4;
/** Share of the half-screen kept free around a flight. */
export const FLIGHT_MARGIN = 0.08;

export const wideView: View = computeCameraParams;

export function closeUpView(target: Vec3, reach: number): View {
  const params = closeUpParams(target, reach);
  return () => params;
}

/** Corners of the box around every hull point of the drawn body over the whole flight. */
export function flightCorners(plan: Playable, hull: readonly Vec3[]): Vec3[] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < frameCount(plan.frames); i += 1) {
    const pose = visualPose(plan, i * STEP_S);
    for (const p of hull) {
      const r = rotate(pose.quaternion, p);
      for (let k = 0; k < 3; k += 1) {
        const v = pose.position[k]! + r[k]!;
        min[k] = Math.min(min[k]!, v);
        max[k] = Math.max(max[k]!, v);
      }
    }
  }
  const corners: Vec3[] = [];
  for (const x of [min[0]!, max[0]!]) {
    for (const y of [min[1]!, max[1]!]) {
      for (const z of [min[2]!, max[2]!]) corners.push([x, y, z]);
    }
  }
  return corners;
}

/** View that keeps every point of one flight in frame; `corners` bound the whole flight. */
export function flightView(corners: readonly Vec3[]): View {
  return (aspect) => fitView(corners, aspect, FLIGHT_MARGIN);
}

export function holdShot(view: View): Shot {
  return { from: view, to: view, startS: 0, durationS: 0 };
}

export function easeOutCubic(p: number): number {
  const c = Math.min(Math.max(p, 0), 1);
  return 1 - (1 - c) ** 3;
}

function shotProgress(shot: Shot, nowS: number): number {
  return shot.durationS > 0 ? easeOutCubic((nowS - shot.startS) / shot.durationS) : 1;
}

/** Blends two views: amount 0 is `from`, 1 is `to`. Both share the tilt, so the blend keeps it. */
export function blendViews(from: CameraParams, to: CameraParams, amount: number): CameraParams {
  const blend = (a: Vec3, b: Vec3): Vec3 => [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
  return {
    fov: from.fov + (to.fov - from.fov) * amount,
    position: blend(from.position, to.position),
    lookAt: blend(from.lookAt, to.lookAt),
  };
}

/** Camera at `nowS`; under reduced motion the camera holds the wide view and never moves. */
export function cameraAt(
  shot: Shot,
  nowS: number,
  aspect: number,
  reducedMotion: boolean,
): CameraParams {
  if (reducedMotion) return wideView(aspect);
  const amount = shotProgress(shot, nowS);
  if (amount >= 1) return shot.to(aspect);
  return blendViews(shot.from(aspect), shot.to(aspect), amount);
}

/** True while the camera is still travelling; never under reduced motion. */
export function isShotMoving(shot: Shot, nowS: number, reducedMotion: boolean): boolean {
  return !reducedMotion && shot.from !== shot.to && nowS - shot.startS < shot.durationS;
}
