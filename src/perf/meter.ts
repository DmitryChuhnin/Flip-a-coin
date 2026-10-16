/** Frames older than this leave the running numbers. */
export const WINDOW_MS = 1000;
/**
 * A frame this long or longer runs at 50 fps or slower; at 60, 90 and 120 Hz such a frame missed
 * a 60 fps frame.
 */
export const SLOW_FRAME_MS = 20;

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

  /**
   * The interval since the last frame; null for the first frame, and for a time that is not
   * finite or does not move forward, which is skipped.
   */
  frame(nowMs: number): number | null {
    if (!Number.isFinite(nowMs) || (this.lastMs !== null && nowMs <= this.lastMs)) return null;
    const ms = this.lastMs === null ? null : nowMs - this.lastMs;
    if (ms !== null) {
      this.recent.push({ atMs: nowMs, ms });
      this.span?.push(ms);
    }
    this.lastMs = nowMs;
    while (this.recent.length > 0 && this.recent[0]!.atMs <= nowMs - WINDOW_MS) this.recent.shift();
    return ms;
  }

  /** False before the first frame and after a pause: the next frame gives no interval. */
  hasLastFrame(): boolean {
    return this.lastMs !== null;
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
