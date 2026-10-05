/** Which sound set an item uses: a ringing coin or a knocking die. */
export type Voice = 'coin' | 'die';

/**
 * `locked`: no gesture has unlocked audio yet, or the browser refused to resume it.
 * `unavailable`: the browser has no Web Audio; the game runs silent and shows no error.
 */
export type AudioState = 'locked' | 'running' | 'unavailable';

export interface SoundOptions {
  /** Returns a new context, or null where Web Audio is missing; may throw. */
  createContext: () => AudioContext | null;
  /** `navigator.vibrate`, or null where the API is missing (Safari on iOS). */
  vibrate: ((ms: number) => boolean) | null;
  enabled: boolean;
  onStateChange?: (state: AudioState) => void;
}

export interface Sound {
  /** Call from a tap or key handler: browsers start audio only inside a user gesture. */
  unlock(): void;
  /** Turns both sound and vibration on or off. */
  setEnabled(enabled: boolean): void;
  launch(voice: Voice): void;
  /** A table hit; `strength` is the approach speed of the lowest point, units/s. */
  impact(voice: Voice, strength: number): void;
  /** The body came to rest. */
  settle(voice: Voice): void;
  state(): AudioState;
}

/** Approach speed that plays at full volume; a first landing is 4 to 17. */
const FULL_STRENGTH = 12;
const MASTER_GAIN = 0.6;
const VIBRATE_MS = 18;
/** Hits closer than this to the previous one merge into it, so a rattle does not stack up. */
const MIN_GAP_S = 0.03;

/** Volume 0..1 for a hit; non-finite or negative strength is silent. */
export function impactGain(strength: number): number {
  if (!Number.isFinite(strength) || strength <= 0) return 0;
  return Math.min(1, strength / FULL_STRENGTH) ** 0.8;
}

export function createSound(options: SoundOptions): Sound {
  let enabled = options.enabled;
  let context: AudioContext | null = null;
  let output: GainNode | null = null;
  let current: AudioState = 'locked';
  let lastHitS = -Infinity;
  /** Launch of the toss in flight that audio was still locked for; dropped at its first hit. */
  let pendingLaunch: Voice | null = null;
  let landed = false;

  function setState(next: AudioState): void {
    if (next === current) return;
    current = next;
    options.onStateChange?.(next);
    if (next === 'running' && pendingLaunch) playLaunch(pendingLaunch);
  }

  function ready(): AudioContext | null {
    return enabled && context && output && context.state === 'running' ? context : null;
  }

  function playLaunch(voice: Voice): void {
    pendingLaunch = null;
    const ctx = ready();
    if (!ctx) return;
    if (voice === 'coin') ring(ctx, output!, 0.55);
    else knock(ctx, output!, 0.55, true);
  }

  function open(): AudioContext | null {
    const created = options.createContext();
    if (!created) return null;
    output = created.createGain();
    output.gain.value = enabled ? MASTER_GAIN : 0;
    output.connect(created.destination);
    created.onstatechange = () => {
      if (created === context) setState(created.state === 'running' ? 'running' : 'locked');
    };
    return created;
  }

  return {
    unlock() {
      if (current === 'unavailable') return;
      try {
        if (!context || context.state === 'closed') {
          context = open();
          if (!context) {
            setState('unavailable');
            return;
          }
        }
        if (context.state === 'running') {
          setState('running');
          return;
        }
        // A refused or pending resume leaves audio locked; the next gesture tries again.
        context.resume().catch(() => {});
      } catch {
        setState('unavailable');
      }
    },
    setEnabled(next) {
      enabled = next;
      // Sounds already started stop too, not only the ones still to come.
      if (context && output)
        output.gain.setValueAtTime(next ? MASTER_GAIN : 0, context.currentTime);
    },
    launch(voice) {
      landed = false;
      if (ready()) playLaunch(voice);
      else pendingLaunch = voice;
    },
    impact(voice, strength) {
      pendingLaunch = null;
      if (enabled && !landed) {
        landed = true;
        options.vibrate?.(VIBRATE_MS);
      }
      const ctx = ready();
      const gain = impactGain(strength);
      if (!ctx || gain === 0 || ctx.currentTime - lastHitS < MIN_GAP_S) return;
      lastHitS = ctx.currentTime;
      if (voice === 'coin') clink(ctx, output!, gain);
      else knock(ctx, output!, gain, false);
    },
    settle(voice) {
      pendingLaunch = null;
      const ctx = ready();
      if (!ctx) return;
      if (voice === 'coin') clink(ctx, output!, 0.12);
      else knock(ctx, output!, 0.12, false);
    },
    state: () => current,
  };
}

// ---- Synthesis ----

/** Decaying sine partials: the ring of a thrown coin. */
function ring(ctx: AudioContext, out: AudioNode, gain: number): void {
  partials(ctx, out, 2400 * jitter(), [1, 2.76, 5.4], gain * 0.5, 0.7);
}

/** A short metallic hit: the coin on the table. */
function clink(ctx: AudioContext, out: AudioNode, gain: number): void {
  partials(ctx, out, 1700 * jitter(), [1, 2.4, 4.1], gain * 0.6, 0.14);
}

/** A band-passed noise burst over a low thump: a die on wood, or flicked off the fingers. */
function knock(ctx: AudioContext, out: AudioNode, gain: number, soft: boolean): void {
  const now = ctx.currentTime;
  const length = Math.ceil(ctx.sampleRate * 0.06);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = (soft ? 1400 : 900) * jitter();
  band.Q.value = 1.2;
  const level = ctx.createGain();
  level.gain.value = gain * (soft ? 0.35 : 0.9);
  noise.connect(band).connect(level).connect(out);
  noise.start(now);

  const thump = ctx.createOscillator();
  thump.frequency.setValueAtTime(soft ? 260 : 170, now);
  thump.frequency.exponentialRampToValueAtTime(90, now + 0.08);
  envelope(ctx, thump, out, gain * (soft ? 0.15 : 0.5), 0.09);
}

function partials(
  ctx: AudioContext,
  out: AudioNode,
  base: number,
  ratios: readonly number[],
  gain: number,
  decayS: number,
): void {
  ratios.forEach((ratio, i) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = base * ratio;
    envelope(ctx, osc, out, gain / (i + 1), decayS / (1 + i * 0.6));
  });
}

/** Plays `source` through a fast attack and an exponential decay, then stops it. */
function envelope(
  ctx: AudioContext,
  source: OscillatorNode,
  out: AudioNode,
  gain: number,
  decayS: number,
): void {
  const now = ctx.currentTime;
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, now);
  level.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), now + 0.004);
  level.gain.exponentialRampToValueAtTime(0.0001, now + decayS);
  source.connect(level).connect(out);
  source.start(now);
  source.stop(now + decayS + 0.02);
}

/** ±4% pitch, so repeated hits do not sound identical. */
function jitter(): number {
  return 0.96 + Math.random() * 0.08;
}
