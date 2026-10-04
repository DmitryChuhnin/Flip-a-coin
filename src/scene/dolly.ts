import type { CameraParams, Vec3 } from './camera';

/** Share of the camera-to-coin distance covered when fully dollied in. */
export const DOLLY_FRACTION = 0.15;
export const DOLLY_DURATION_S = 0.4;

export interface DollyAnimation {
  from: number;
  to: number;
  startS: number;
}

export const DOLLY_AT_REST: DollyAnimation = { from: 0, to: 0, startS: 0 };

export function easeOutCubic(p: number): number {
  const c = Math.min(Math.max(p, 0), 1);
  return 1 - (1 - c) ** 3;
}

/** Dolly amount in [0, 1] at time `nowS`; always 0 under reduced motion. */
export function dollyAmount(
  animation: DollyAnimation,
  nowS: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 0;
  const p = easeOutCubic((nowS - animation.startS) / DOLLY_DURATION_S);
  return animation.from + (animation.to - animation.from) * p;
}

/** Starts a move from wherever the camera is now toward `to`. */
export function retarget(
  animation: DollyAnimation,
  to: number,
  nowS: number,
  reducedMotion: boolean,
): DollyAnimation {
  return { from: dollyAmount(animation, nowS, reducedMotion), to, startS: nowS };
}

/** Moves the camera and its look-at point toward `target` by `amount` of DOLLY_FRACTION. */
export function applyDolly(base: CameraParams, target: Vec3, amount: number): CameraParams {
  const k = DOLLY_FRACTION * amount;
  const toward = (from: Vec3): Vec3 => [
    from[0] + (target[0] - from[0]) * k,
    from[1] + (target[1] - from[1]) * k,
    from[2] + (target[2] - from[2]) * k,
  ];
  return { fov: base.fov, position: toward(base.position), lookAt: toward(base.lookAt) };
}
