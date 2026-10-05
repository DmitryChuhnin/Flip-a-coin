import { describe, expect, it } from 'vitest';
import { IDENTITY } from '../math/quat';
import { FRAME_STRIDE } from '../physics/frames';
import { closeUpParams, computeCameraParams, DEFAULT_ASPECT, type Vec3 } from './camera';
import {
  blendViews,
  cameraAt,
  closeUpView,
  easeOutCubic,
  flightCorners,
  flightView,
  holdShot,
  isShotMoving,
  wideView,
  type Shot,
} from './shots';

const PORTRAIT = 9 / 19.5;
const COIN: Vec3 = [0.5, 0.07, 1];

function frames(positions: Vec3[]): Float32Array {
  const out = new Float32Array(positions.length * FRAME_STRIDE);
  positions.forEach((p, i) => out.set([...p, ...IDENTITY], i * FRAME_STRIDE));
  return out;
}

const NO_BLEND = { startS: 0, endS: 0 };
const launch: Shot = {
  from: closeUpView(COIN, 1),
  to: wideView,
  startS: 10,
  durationS: 0.4,
};

describe('easeOutCubic', () => {
  it('runs from 0 to 1 and clamps outside', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe('blendViews', () => {
  const a = closeUpParams(COIN, 1);
  const b = computeCameraParams(PORTRAIT);

  it('returns the first view at 0 and the second at 1', () => {
    expect(blendViews(a, b, 0)).toEqual(a);
    const end = blendViews(a, b, 1);
    for (let k = 0; k < 3; k += 1) {
      expect(end.position[k]).toBeCloseTo(b.position[k]!, 9);
      expect(end.lookAt[k]).toBeCloseTo(b.lookAt[k]!, 9);
    }
  });

  it('keeps the 30° tilt halfway', () => {
    const mid = blendViews(a, b, 0.5);
    const dy = mid.position[1] - mid.lookAt[1];
    const dz = mid.position[2] - mid.lookAt[2];
    expect((Math.atan2(dy, dz) * 180) / Math.PI).toBeCloseTo(30, 9);
  });
});

describe('cameraAt', () => {
  it('starts at the first view, eases and ends at the second', () => {
    expect(cameraAt(launch, 10, PORTRAIT, false)).toEqual(closeUpParams(COIN, 1));
    const mid = cameraAt(launch, 10.2, PORTRAIT, false);
    expect(mid.position[2]).toBeGreaterThan(closeUpParams(COIN, 1).position[2]);
    expect(cameraAt(launch, 10.4, PORTRAIT, false)).toEqual(computeCameraParams(PORTRAIT));
    expect(cameraAt(launch, 99, PORTRAIT, false)).toEqual(computeCameraParams(PORTRAIT));
  });

  it('holds the wide view under reduced motion at any time', () => {
    for (const t of [0, 10, 10.2, 99]) {
      expect(cameraAt(launch, t, PORTRAIT, true)).toEqual(computeCameraParams(PORTRAIT));
    }
  });

  it('recomputes the view for the current aspect after a resize', () => {
    expect(cameraAt(launch, 99, 16 / 9, false)).toEqual(computeCameraParams(16 / 9));
  });

  it('falls back to the default aspect for a degenerate one', () => {
    for (const aspect of [Number.NaN, 0, -1]) {
      expect(cameraAt(launch, 99, aspect, false)).toEqual(computeCameraParams(DEFAULT_ASPECT));
    }
  });
});

describe('isShotMoving', () => {
  it('is true until the shot duration has passed', () => {
    expect(isShotMoving(launch, 10, false)).toBe(true);
    expect(isShotMoving(launch, 10.39, false)).toBe(true);
    expect(isShotMoving(launch, 10.4, false)).toBe(false);
  });

  it('is false for a hold and under reduced motion', () => {
    expect(isShotMoving(holdShot(wideView), 0, false)).toBe(false);
    expect(isShotMoving(launch, 10.1, true)).toBe(false);
  });
});

describe('flightCorners', () => {
  const plan = {
    frames: frames([
      [0, 0.5, 1],
      [1, 3, 0],
      [-1, 0.5, -2],
    ]),
    visualOffset: IDENTITY,
    blend: NO_BLEND,
  };
  const hull: Vec3[] = [
    [0.5, 0, 0],
    [-0.5, 0, 0],
    [0, 0.25, 0],
    [0, -0.25, 0],
    [0, 0, 0.5],
    [0, 0, -0.5],
  ];

  it('bounds every hull point over the flight', () => {
    const corners = flightCorners(plan, hull);
    expect(corners).toHaveLength(8);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const zs = corners.map((c) => c[2]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-1.5, 1.5]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([0.25, 3.25]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([-2.5, 1.5]);
  });

  it('gives a view that sees the low flight closer than the wide view', () => {
    const view = flightView(flightCorners(plan, hull))(PORTRAIT);
    const wide = computeCameraParams(PORTRAIT);
    const distance = (p: { position: Vec3; lookAt: Vec3 }) =>
      Math.hypot(...p.position.map((v, k) => v - p.lookAt[k]!));
    expect(distance(view)).toBeLessThan(distance(wide));
  });
});
