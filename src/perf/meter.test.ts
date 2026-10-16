import { describe, expect, it } from 'vitest';
import { FrameMeter, SLOW_FRAME_MS, WINDOW_MS } from './meter';

function run(meter: FrameMeter, startMs: number, intervals: readonly number[]): number {
  let atMs = startMs;
  meter.frame(atMs);
  for (const ms of intervals) meter.frame((atMs += ms));
  return atMs;
}

describe('FrameMeter', () => {
  it('has no numbers before two frames', () => {
    const meter = new FrameMeter();
    expect(meter.last()).toEqual({ fps: null, worstMs: null, slow: 0, frames: 0 });
    meter.frame(1000);
    expect(meter.last()).toEqual({ fps: null, worstMs: null, slow: 0, frames: 0 });
  });

  it('counts the frame rate, the longest frame and the slow frames of the last second', () => {
    const meter = new FrameMeter();
    run(meter, 0, [16, 16, SLOW_FRAME_MS, 16, SLOW_FRAME_MS - 1]);
    expect(meter.last()).toEqual({
      fps: (5 * 1000) / (48 + SLOW_FRAME_MS + SLOW_FRAME_MS - 1),
      worstMs: SLOW_FRAME_MS,
      slow: 1,
      frames: 5,
    });
  });

  it('drops frames older than the window', () => {
    const meter = new FrameMeter();
    const atMs = run(meter, 0, [100, ...Array<number>(WINDOW_MS / 10).fill(10)]);
    expect(meter.last().worstMs).toBe(10);
    expect(meter.last().frames).toBe(WINDOW_MS / 10);
    meter.frame(atMs + WINDOW_MS);
    expect(meter.last()).toMatchObject({ frames: 1, worstMs: WINDOW_MS });
  });

  it('does not count a pause as a frame', () => {
    const meter = new FrameMeter();
    const atMs = run(meter, 0, [16, 16]);
    meter.pause();
    expect(meter.last().frames).toBe(0);
    run(meter, atMs + 30_000, [16]);
    expect(meter.last()).toMatchObject({ frames: 1, worstMs: 16 });
  });

  it('skips a timestamp that does not move forward or is not finite', () => {
    const meter = new FrameMeter();
    expect(meter.frame(NaN)).toBeNull();
    run(meter, 1000, [16, 0, -5, 16]);
    expect(meter.frame(Infinity)).toBeNull();
    expect(meter.frame(1043)).toBe(16);
    expect(meter.last()).toEqual({ fps: (3 * 1000) / 43, worstMs: 16, slow: 0, frames: 3 });
  });

  it('counts a span from its start to its end, past the window', () => {
    const meter = new FrameMeter();
    expect(meter.endSpan()).toBeNull();
    const atMs = run(meter, 0, [16]);
    meter.startSpan();
    run(meter, atMs + 40, Array<number>(99).fill(16));
    expect(meter.endSpan()).toEqual({
      fps: (100 * 1000) / (40 + 99 * 16),
      worstMs: 40,
      slow: 1,
      frames: 100,
    });
    expect(meter.endSpan()).toBeNull();
  });

  it('leaves a pause out of a span', () => {
    const meter = new FrameMeter();
    meter.startSpan();
    const atMs = run(meter, 0, [16, 16]);
    meter.pause();
    run(meter, atMs + 30_000, [16]);
    expect(meter.endSpan()).toMatchObject({ frames: 3, worstMs: 16 });
  });

  it('gives an empty span when no frame arrived in it', () => {
    const meter = new FrameMeter();
    meter.startSpan();
    expect(meter.endSpan()).toEqual({ fps: null, worstMs: null, slow: 0, frames: 0 });
  });
});
