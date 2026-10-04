import { describe, expect, it } from 'vitest';
import { fromAxisAngle, IDENTITY, multiply, type Quat } from '../math/quat';
import { STEP_S } from '../physics/frames';
import { blendProgress, bodyPose, FrameClock, MAX_FRAME_STEP_S, visualPose } from './playback';

const QUARTER: Quat = fromAxisAngle([0, 1, 0], Math.PI / 2);
const HALF_TURN_X: Quat = fromAxisAngle([1, 0, 0], Math.PI);
// Three frames: at rest, moved up and turned a quarter about Y, then moved sideways.
const FRAMES = new Float32Array([0, 0, 0, ...IDENTITY, 0, 1, 0, ...QUARTER, 2, 1, 0, ...QUARTER]);

function expectQuat(actual: Quat, expected: Quat) {
  const sign = Math.sign(actual[3] * expected[3] || 1);
  for (let k = 0; k < 4; k += 1) expect(actual[k]! * sign).toBeCloseTo(expected[k]!, 5);
}

describe('bodyPose', () => {
  it('returns the stored frames at their exact times', () => {
    expect(bodyPose(FRAMES, 0).position).toEqual([0, 0, 0]);
    expect(bodyPose(FRAMES, STEP_S).position).toEqual([0, 1, 0]);
    expectQuat(bodyPose(FRAMES, STEP_S).quaternion, QUARTER);
    expect(bodyPose(FRAMES, 2 * STEP_S).position).toEqual([2, 1, 0]);
  });

  it('interpolates position linearly and rotation spherically between frames', () => {
    const pose = bodyPose(FRAMES, STEP_S / 2);
    expect(pose.position[1]).toBeCloseTo(0.5, 6);
    expectQuat(pose.quaternion, fromAxisAngle([0, 1, 0], Math.PI / 4));
  });

  it('clamps times past the end to the last frame and before the start to the first', () => {
    expect(bodyPose(FRAMES, 10).position).toEqual([2, 1, 0]);
    expect(bodyPose(FRAMES, -1).position).toEqual([0, 0, 0]);
    expect(bodyPose(FRAMES, Number.NaN).position).toEqual([0, 0, 0]);
  });

  it('plays a single frame and rejects an empty track', () => {
    expect(bodyPose(FRAMES.slice(0, 7), 5).position).toEqual([0, 0, 0]);
    expect(() => bodyPose(new Float32Array(), 0)).toThrow(RangeError);
  });
});

describe('visualPose', () => {
  const plan = {
    frames: FRAMES,
    visualOffset: HALF_TURN_X,
    blend: { startS: 0, endS: 2 * STEP_S },
  };

  it('shows the body pose before the blend and body times offset after it', () => {
    expectQuat(visualPose(plan, 0).quaternion, IDENTITY);
    expectQuat(visualPose(plan, 2 * STEP_S).quaternion, multiply(QUARTER, HALF_TURN_X));
    expectQuat(visualPose(plan, 99).quaternion, multiply(QUARTER, HALF_TURN_X));
  });

  it('turns halfway through the offset at the middle of the blend', () => {
    expectQuat(
      visualPose(plan, STEP_S).quaternion,
      multiply(QUARTER, fromAxisAngle([1, 0, 0], Math.PI / 2)),
    );
  });

  it('eases the blend with zero speed at both ends', () => {
    const window = { startS: 1, endS: 2 };
    expect(blendProgress(window, 1)).toBe(0);
    expect(blendProgress(window, 1.5)).toBeCloseTo(0.5, 9);
    expect(blendProgress(window, 2)).toBe(1);
    expect(blendProgress(window, 1.001)).toBeLessThan(0.0001);
    expect(blendProgress({ startS: 0, endS: 0 }, 0)).toBe(1);
  });
});

describe('FrameClock', () => {
  it('returns 0 on the first tick and the elapsed seconds afterwards', () => {
    const clock = new FrameClock();
    expect(clock.tick(1000)).toBe(0);
    expect(clock.tick(1016)).toBeCloseTo(0.016, 9);
  });

  it('clamps a huge gap, such as a hidden tab, to the maximum step', () => {
    const clock = new FrameClock();
    clock.tick(0);
    expect(clock.tick(60_000)).toBe(MAX_FRAME_STEP_S);
  });

  it('restarts from 0 after a reset', () => {
    const clock = new FrameClock();
    clock.tick(0);
    clock.reset();
    expect(clock.tick(5000)).toBe(0);
  });

  it('ignores time going backwards and non-finite timestamps', () => {
    const clock = new FrameClock();
    clock.tick(1000);
    expect(clock.tick(900)).toBe(0);
    expect(clock.tick(Number.NaN)).toBe(0);
    expect(clock.tick(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clock.tick(916)).toBeCloseTo(0.016, 6);
  });
});
