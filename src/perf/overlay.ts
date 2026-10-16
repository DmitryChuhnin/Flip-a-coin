import type { TossState } from '../game';
import type { TossEngine } from '../toss/engine';
import { FrameMeter, WINDOW_MS, type FrameNumbers } from './meter';

/** How often the text changes; faster is unreadable and costs a layout per frame. */
export const REFRESH_MS = 250;

export interface PerfOverlay {
  /** The same engine with `plan` and `prepare` timed; results and errors pass through unchanged. */
  time(engine: TossEngine): TossEngine;
  /** Counts the frames of a flight, from `flying` to the next state. */
  onState(state: TossState): void;
}

export interface PerfHost {
  document: Document;
  now: () => number;
  requestFrame: (callback: (nowMs: number) => void) => void;
}

// Frame times round down, as `slow` compares them; work times round up, as a budget is a ceiling.
const frameMs = (value: number | null) => (value === null ? '-' : `${Math.floor(value)} ms`);
const workMs = (value: number | null) => (value === null ? '-' : `${Math.ceil(value)} ms`);
const fps = (value: number | null) => (value === null ? '-' : String(Math.round(value)));

function framesLine(label: string, numbers: FrameNumbers | null): string {
  if (!numbers || numbers.frames === 0) return `${label} -`;
  const { fps: rate, worstMs, slow, frames } = numbers;
  return `${label} ${fps(rate)} fps, worst ${frameMs(worstMs)}, slow ${slow}/${frames}`;
}

/** Frame rate and toss planning time in a corner of the page, to check a phone without DevTools. */
export function startPerfOverlay({ document, now, requestFrame }: PerfHost): PerfOverlay {
  const panel = document.createElement('pre');
  panel.id = 'perf';
  panel.setAttribute('aria-hidden', 'true');
  document.body.append(panel);

  const meter = new FrameMeter();
  let planMs: number | null = null;
  let prepareMs: number | null = null;
  let flight: FrameNumbers | null = null;
  let flying = false;
  let shownAtMs = -Infinity;

  function render(): void {
    panel.textContent = [
      framesLine(`last ${WINDOW_MS / 1000} s`, meter.last()),
      framesLine('flight', flight),
      `plan ${workMs(planMs)}, prepare ${workMs(prepareMs)}`,
    ].join('\n');
  }

  function tick(nowMs: number): void {
    meter.frame(nowMs);
    if (nowMs - shownAtMs >= REFRESH_MS) {
      shownAtMs = nowMs;
      render();
    }
    requestFrame(tick);
  }

  function measure<R>(run: () => R, report: (ms: number) => void): R {
    const startMs = now();
    try {
      return run();
    } finally {
      report(now() - startMs);
    }
  }

  // On showing too: a frame already scheduled may run after the tab hides.
  document.addEventListener('visibilitychange', () => meter.pause());
  render();
  requestFrame(tick);

  // The engine records a body's fallbacks once; a later prepare of that body returns at once.
  const prepared = new WeakSet<object>();

  return {
    time(engine) {
      return {
        prepare: (body) => {
          if (prepared.has(body)) return engine.prepare(body);
          measure(
            () => engine.prepare(body),
            (value) => (prepareMs = value),
          );
          prepared.add(body);
        },
        plan: (body, start, reducedMotion) =>
          measure(
            () => engine.plan(body, start, reducedMotion),
            (value) => (planMs = value),
          ),
      };
    },
    onState(state) {
      if (state === 'flying') {
        flying = true;
        meter.startSpan();
      } else if (flying) {
        flying = false;
        flight = meter.endSpan();
      }
    },
  };
}
