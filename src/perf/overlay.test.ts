// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pose } from '../math/quat';
import type { TossEngine } from '../toss/engine';
import type { TossPlan } from '../toss/planToss';
import { REFRESH_MS, startPerfOverlay } from './overlay';

function host() {
  let nowMs = 0;
  let frameAtMs = 0;
  let next: ((nowMs: number) => void) | null = null;
  const overlay = startPerfOverlay({
    document,
    now: () => nowMs,
    requestFrame: (callback) => (next = callback),
  });
  const frames = (...intervals: number[]) => {
    for (const ms of intervals) {
      frameAtMs += ms;
      const callback = next!;
      next = null;
      callback(frameAtMs);
    }
  };
  const advance = (ms: number) => (nowMs += ms);
  return { overlay, frames, advance };
}

const panel = () => document.getElementById('perf')!;
const PLAN = { outcome: 'heads' } as unknown as TossPlan<string>;
const BODY = {} as Parameters<TossEngine['plan']>[0];
const START: Pose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };

describe('startPerfOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('adds a panel hidden from screen readers that shows dashes before any numbers', () => {
    host();
    expect(panel().getAttribute('aria-hidden')).toBe('true');
    expect(panel().textContent).toBe('last 1 s -\nflight -\nplan -, prepare -');
  });

  it('shows the last second at most every refresh interval', () => {
    const { frames } = host();
    frames(16);
    expect(panel().textContent).toContain('last 1 s -');
    frames(17, 30);
    expect(panel().textContent).toContain('last 1 s -');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain(`worst ${REFRESH_MS} ms, slow 2/3`);
  });

  const thrown = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error;
    }
    throw new Error('did not throw');
  };

  it('times plan and prepare and passes their results and errors through', () => {
    const { overlay, advance, frames } = host();
    const failure = new RangeError('broken plan');
    const engine: TossEngine = {
      prepare: vi.fn(() => void advance(80)),
      plan: vi
        .fn()
        .mockImplementationOnce(() => {
          advance(12);
          return PLAN;
        })
        .mockImplementationOnce(() => {
          advance(7);
          throw failure;
        }) as TossEngine['plan'],
    };
    const timed = overlay.time(engine);
    timed.prepare(BODY);
    expect(engine.prepare).toHaveBeenCalledWith(BODY);
    expect(timed.plan(BODY, START, true)).toBe(PLAN);
    expect(engine.plan).toHaveBeenCalledWith(BODY, START, true);
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('plan 12 ms, prepare 80 ms');
    expect(thrown(() => timed.plan(BODY, START, false))).toBe(failure);
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('plan 7 ms, prepare 80 ms');
  });

  it('shows the first prepare of each body, not the instant repeats', () => {
    const { overlay, advance, frames } = host();
    const engine = { prepare: vi.fn(() => void advance(80)), plan: vi.fn() } as TossEngine;
    const timed = overlay.time(engine);
    timed.prepare(BODY);
    vi.mocked(engine.prepare).mockImplementation(() => void advance(1));
    timed.prepare(BODY);
    expect(engine.prepare).toHaveBeenCalledTimes(2);
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('prepare 80 ms');
    timed.prepare({ ...BODY });
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('prepare 1 ms');
  });

  it('passes a prepare error through and times the next prepare of that body', () => {
    const { overlay, advance, frames } = host();
    const failure = new RangeError('broken fallback');
    const engine = { prepare: vi.fn(), plan: vi.fn() } as TossEngine;
    vi.mocked(engine.prepare)
      .mockImplementationOnce(() => {
        advance(30);
        throw failure;
      })
      .mockImplementationOnce(() => void advance(90));
    const timed = overlay.time(engine);
    expect(thrown(() => timed.prepare(BODY))).toBe(failure);
    timed.prepare(BODY);
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('prepare 90 ms');
  });

  it('counts the frames of a flight and keeps them after landing', () => {
    const { overlay, frames } = host();
    frames(16);
    overlay.onState('flying');
    frames(40, 16, 16);
    overlay.onState('result');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('flight 42 fps, worst 40 ms, slow 1/3');
    overlay.onState('idle');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('flight 42 fps');
  });

  it('ends a flight on whatever state follows it', () => {
    const { overlay, frames } = host();
    overlay.onState('flying');
    frames(16, 16);
    overlay.onState('error');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('flight 63 fps, worst 16 ms, slow 0/1');
  });

  it('does not count the time the tab was hidden as a frame', () => {
    const { frames } = host();
    frames(16, 16);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    frames(30_000, 16, REFRESH_MS);
    expect(panel().textContent).toContain(`worst ${REFRESH_MS} ms, slow 1/2`);
  });
});
