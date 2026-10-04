import { beforeAll, describe, expect, it } from 'vitest';
import { CIRCUMRADIUS, COIN_BODY, INITIAL_POSE, THICKNESS } from '../coin/coinSpec';
import { upFace } from '../toss/faces';
import { FRAME_STRIDE, frameCount, framePose, STEP_S, WALL_INNER } from './frames';
import { initPhysics, MAX_SIMULATED_S, simulateToss, type TossInput } from './simulate';

const TOSS: TossInput = {
  hull: COIN_BODY.hull,
  density: COIN_BODY.density,
  start: INITIAL_POSE,
  linearVelocity: [0.2, 10.5, -0.6],
  angularVelocity: [16, 0.5, 0],
  angularDamping: 0.3,
};

beforeAll(async () => {
  await initPhysics();
});

describe('simulateToss', () => {
  it('settles flat within the time limit with finite frames and a recorded landing', () => {
    const sim = simulateToss(TOSS);
    const count = frameCount(sim.frames);

    expect(sim.settled).toBe(true);
    expect((count - 1) * STEP_S).toBeLessThan(MAX_SIMULATED_S);
    expect(sim.frames.length).toBe(count * FRAME_STRIDE);
    expect(sim.frames.every(Number.isFinite)).toBe(true);
    expect(sim.contacts.length).toBeGreaterThanOrEqual(1);
    for (const contact of sim.contacts) {
      expect(contact.frame).toBeGreaterThan(0);
      expect(contact.frame).toBeLessThan(count);
      expect(contact.strength).toBeGreaterThan(0);
    }

    const rest = framePose(sim.frames, count - 1);
    expect(rest.position[1]).toBeCloseTo(THICKNESS / 2, 2);
    expect(upFace(rest.quaternion, COIN_BODY.faces).tiltDeg).toBeLessThan(1);
  });

  it('starts at the given pose and keeps the coin inside the walls', () => {
    const sim = simulateToss(TOSS);
    expect(framePose(sim.frames, 0).position).toEqual(INITIAL_POSE.position.map(Math.fround));
    for (let i = 0; i < frameCount(sim.frames); i += 1) {
      const [x, y, z] = framePose(sim.frames, i).position;
      expect(Math.abs(x)).toBeLessThan(WALL_INNER.x);
      expect(Math.abs(z)).toBeLessThan(WALL_INNER.z);
      expect(y).toBeGreaterThan(0);
    }
  });

  it('keeps a coin thrown hard at a wall inside the walls', () => {
    const sim = simulateToss({ ...TOSS, linearVelocity: [12, 6, 0] });
    for (let i = 0; i < frameCount(sim.frames); i += 1) {
      const [x] = framePose(sim.frames, i).position;
      expect(x).toBeLessThan(WALL_INNER.x - CIRCUMRADIUS * 0.5);
    }
  });

  it('is deterministic for the same input', () => {
    expect(simulateToss(TOSS).frames).toEqual(simulateToss(TOSS).frames);
  });

  it('records no landing for a body resting on the table', () => {
    const sim = simulateToss({ ...TOSS, linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
    expect(sim.settled).toBe(true);
    expect(sim.contacts).toEqual([]);
  });

  it('stops at the time limit and reports not settled', () => {
    // Free fall from this height lasts longer than the limit.
    const sim = simulateToss({
      ...TOSS,
      start: { ...INITIAL_POSE, position: [0, 400, 0] },
      linearVelocity: [0, 0, 0],
    });
    expect(sim.settled).toBe(false);
    expect(frameCount(sim.frames)).toBe(Math.round(MAX_SIMULATED_S / STEP_S) + 1);
  });

  it('throws on a degenerate hull', () => {
    expect(() => simulateToss({ ...TOSS, hull: new Float32Array([0, 0, 0, 1, 0, 0]) })).toThrow();
  });
});
