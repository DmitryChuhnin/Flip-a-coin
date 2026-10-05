import { describe, expect, it } from 'vitest';
import { IDENTITY, type Quat } from '../math/quat';
import { FRAME_STRIDE, STEP_S, stillSinceS } from './frames';

function recording(poses: [number, Quat][]): Float32Array {
  const frames = new Float32Array(poses.length * FRAME_STRIDE);
  poses.forEach(([y, q], i) => frames.set([0, y, 0, ...q], i * FRAME_STRIDE));
  return frames;
}

/** Rotation by `deg` about X. */
function tilt(deg: number): Quat {
  const half = (deg * Math.PI) / 360;
  return [Math.sin(half), 0, 0, Math.cos(half)];
}

describe('stillSinceS', () => {
  it('returns the time of the last visible move, not the end of the recording', () => {
    const frames = recording([
      [2, IDENTITY],
      [1, IDENTITY],
      [0.5, IDENTITY],
      [0.5, IDENTITY],
      [0.5, IDENTITY],
    ]);
    expect(stillSinceS(frames)).toBeCloseTo(2 * STEP_S);
  });

  it('counts a rocking wider than half a degree as motion, and a smaller one as rest', () => {
    const rocking = recording([
      [0.5, tilt(1)],
      [0.5, IDENTITY],
      [0.5, IDENTITY],
    ]);
    expect(stillSinceS(rocking)).toBeCloseTo(STEP_S);
    const trembling = recording([
      [0.5, tilt(0.2)],
      [0.5, IDENTITY],
      [0.5, IDENTITY],
    ]);
    expect(stillSinceS(trembling)).toBe(0);
  });

  it('is zero for an empty, one-frame or wholly still recording', () => {
    expect(stillSinceS(new Float32Array(0))).toBe(0);
    expect(stillSinceS(recording([[1, IDENTITY]]))).toBe(0);
    expect(
      stillSinceS(
        recording([
          [1, IDENTITY],
          [1, IDENTITY],
        ]),
      ),
    ).toBe(0);
  });

  it('keeps a body that ends in motion moving to the last frame', () => {
    const frames = recording([
      [1, IDENTITY],
      [0.9, IDENTITY],
      [0.8, IDENTITY],
    ]);
    expect(stillSinceS(frames)).toBeCloseTo(2 * STEP_S);
  });
});
