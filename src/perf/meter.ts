/** Frames older than this leave the running numbers. */
export const WINDOW_MS = 1000;
/** A frame this long or longer drops below 40 fps, a visible stutter at a 60 fps target. */
export const SLOW_FRAME_MS = 25;

export interface FrameNumbers {
  /** Frames per second; null until two frames arrive. */
  fps: number | null;
  /** Longest frame, ms; null until two frames arrive. */
  worstMs: number | null;
  /** Frames at least `SLOW_FRAME_MS` long. */
  slow: number;
  /** Frames counted, each one interval between two animation frames. */
  frames: number;
}

function numbers(intervals: readonly number[]): FrameNumbers {
  if (intervals.length === 0) return { fps: null, worstMs: null, slow: 0, frames: 0 };
  const total = intervals.reduce((sum, ms) => sum + ms, 0);
  return {
    fps: total > 0 ? (intervals.length * 1000) / total : null,
    worstMs: Math.max(...intervals),
    slow: intervals.filter((ms) => ms >= SLOW_FRAME_MS).length,
    frames: intervals.length,
  };
}

/** Frame intervals from animation frame timestamps: the last second, and one span on demand. */
export class FrameMeter {
  private lastMs: number | null = null;
  private recent: { atMs: number; ms: number }[] = [];
  private span: number[] | null = null;

  frame(nowMs: number): void {
    if (this.lastMs !== null && nowMs > this.lastMs) {
      const ms = nowMs - this.lastMs;
      this.recent.push({ atMs: nowMs, ms });
      this.span?.push(ms);
    }
    this.lastMs = nowMs;
    while (this.recent.length > 0 && this.recent[0]!.atMs <= nowMs - WINDOW_MS) this.recent.shift();
  }

  /** Forgets the last frame, so a pause (hidden tab) does not count as one long frame. */
  pause(): void {
    this.lastMs = null;
    this.recent = [];
  }

  last(): FrameNumbers {
    return numbers(this.recent.map(({ ms }) => ms));
  }

  startSpan(): void {
    this.span = [];
  }

  /** Numbers since `startSpan`; null without a span. */
  endSpan(): FrameNumbers | null {
    const span = this.span;
    this.span = null;
    return span && numbers(span);
  }
}
