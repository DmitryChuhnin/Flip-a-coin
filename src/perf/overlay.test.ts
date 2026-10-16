// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pose } from '../math/quat';
import type { TossEngine } from '../toss/engine';
import type { TossPlan } from '../toss/planToss';
import { SLOW_FRAME_MS } from './meter';
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
  const stamp = (stampMs: number) => {
    const callback = next!;
    next = null;
    callback(stampMs);
  };
  return { overlay, frames, advance, stamp };
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
    expect(panel().textContent).toBe('last 1 s -\nlast flight -\ntap frame -, plan -, prepare -');
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

  // The overlay reads the end of the tap handler in a microtask.
  const handlerEnd = () => Promise.resolve();

  it('counts the frames of a flight apart from the tap frame and keeps them after landing', async () => {
    const { overlay, advance, frames } = host();
    frames(16);
    advance(20);
    overlay.onState('flying');
    await handlerEnd();
    frames(40, 16, 18);
    overlay.onState('result');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('last flight 59 fps, worst 18 ms, slow 0/2');
    expect(panel().textContent).toContain('tap frame 40 ms');
    overlay.onState('idle');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('last flight 59 fps');
  });

  it('ends a flight on whatever state follows it, and knows no tap frame before any frame', async () => {
    const { overlay, frames } = host();
    overlay.onState('flying');
    await handlerEnd();
    frames(16, 16);
    overlay.onState('error');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('last flight 63 fps, worst 16 ms, slow 0/1');
    expect(panel().textContent).toContain('tap frame -');
  });

  it('counts the frames stamped before the tap handler ended into the tap frame', async () => {
    // Chromium stamps a late frame with its vsync time and skips the vsync the handler overran.
    const { overlay, advance, frames } = host();
    frames(16, 16);
    advance(70);
    overlay.onState('flying');
    await handlerEnd();
    frames(17, 33, 16, 17);
    overlay.onState('result');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('tap frame 50 ms');
    expect(panel().textContent).toContain('last flight 61 fps, worst 17 ms, slow 0/2');
  });

  it('folds a stamp that does not move forward into the tap frame', async () => {
    const { overlay, advance, frames } = host();
    frames(16);
    advance(20);
    overlay.onState('flying');
    await handlerEnd();
    frames(0, 34, 16);
    overlay.onState('result');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('tap frame 34 ms');
    expect(panel().textContent).toContain('last flight 63 fps, worst 16 ms, slow 0/1');
  });

  it('shows no tap frame for a flight that ended before its frame came', async () => {
    const { overlay, advance, frames } = host();
    frames(16);
    advance(20);
    overlay.onState('flying');
    await handlerEnd();
    frames(40, 16);
    overlay.onState('result');
    overlay.onState('idle');
    advance(100);
    overlay.onState('flying');
    overlay.onState('error');
    await handlerEnd();
    frames(16, REFRESH_MS);
    expect(panel().textContent).toContain('last flight -');
    expect(panel().textContent).toContain('tap frame -');
  });

  it('skips an infinite stamp, which closes no tap and keeps the panel refreshing', async () => {
    const { overlay, advance, frames, stamp } = host();
    frames(16);
    advance(20);
    overlay.onState('flying');
    await handlerEnd();
    stamp(Infinity);
    frames(40, 16);
    overlay.onState('result');
    frames(REFRESH_MS);
    expect(panel().textContent).toContain('tap frame 40 ms');
    expect(panel().textContent).toContain('last flight 63 fps, worst 16 ms, slow 0/1');
  });

  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('does not count the time the tab was hidden as a frame', () => {
    const { frames } = host();
    frames(16, 16);
    setHidden(true);
    setHidden(false);
    frames(30_000, 16, REFRESH_MS);
    expect(panel().textContent).toContain(`worst ${REFRESH_MS} ms, slow 1/2`);
  });

  it('shows no tap frame when the tab hid before the frames after the tap handler', async () => {
    const { overlay, advance, frames } = host();
    frames(16);
    advance(40);
    overlay.onState('flying');
    await handlerEnd();
    setHidden(true);
    setHidden(false);
    frames(30_000, 16, REFRESH_MS);
    expect(panel().textContent).toContain('tap frame -');
  });

  it('does not count a hidden time that a late frame started either', () => {
    const { frames } = host();
    frames(16);
    setHidden(true);
    frames(16);
    setHidden(false);
    frames(30_000, REFRESH_MS);
    expect(panel().textContent).toContain(`worst ${REFRESH_MS} ms, slow 1/1`);
  });

  it('rounds frame times down and work times up, as the slow count and a budget read them', () => {
    const { overlay, advance, frames } = host();
    const engine: TossEngine = {
      prepare: () => void advance(40.2),
      plan: vi.fn().mockImplementation(() => {
        advance(29.1);
        return PLAN;
      }) as TossEngine['plan'],
    };
    const timed = overlay.time(engine);
    timed.prepare(BODY);
    timed.plan(BODY, START, false);
    frames(16, ...Array<number>(13).fill(SLOW_FRAME_MS - 0.4));
    expect(panel().textContent).toContain(`worst ${SLOW_FRAME_MS - 1} ms, slow 0/13`);
    expect(panel().textContent).toContain('plan 30 ms, prepare 41 ms');
  });

  it('passes a thrown value that is not an Error through as it is', () => {
    const { overlay } = host();
    const engine = { prepare: vi.fn(), plan: vi.fn() } as TossEngine;
    vi.mocked(engine.plan).mockImplementation(() => {
      throw 'no plan';
    });
    expect(thrown(() => overlay.time(engine).plan(BODY, START, false))).toBe('no plan');
  });
});
