import { describe, expect, it, vi } from 'vitest';
import { createSound, impactGain, type AudioState, type SoundOptions } from './sound';

function param() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function node() {
  const n = { connect: vi.fn(() => n), start: vi.fn(), stop: vi.fn() };
  return n;
}

/** Just enough of an AudioContext to count the sounds started on it. */
class FakeContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  onstatechange: (() => void) | null = null;
  started = 0;
  resumeResult: 'resolve' | 'reject' = 'resolve';

  resume = vi.fn(() => {
    if (this.resumeResult === 'reject') return Promise.reject(new Error('not allowed'));
    // Browsers report the new state after the call returns.
    return Promise.resolve().then(() => this.setRunning());
  });

  setRunning(): void {
    this.state = 'running';
    this.onstatechange?.();
  }

  createGain() {
    return { ...node(), gain: param() };
  }

  createOscillator() {
    const osc = { ...node(), frequency: param() };
    osc.start = vi.fn(() => {
      this.started += 1;
    });
    return osc;
  }

  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }

  createBufferSource() {
    const source = { ...node(), buffer: null as unknown };
    source.start = vi.fn(() => {
      this.started += 1;
    });
    return source;
  }

  createBiquadFilter() {
    return { ...node(), type: '', frequency: param(), Q: param() };
  }
}

function setup(overrides: Partial<SoundOptions> = {}) {
  const context = new FakeContext();
  const states: AudioState[] = [];
  const vibrate = vi.fn(() => true);
  const sound = createSound({
    createContext: () => context as unknown as AudioContext,
    vibrate,
    enabled: true,
    onStateChange: (state) => states.push(state),
    ...overrides,
  });
  return { sound, context, states, vibrate };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('impactGain', () => {
  it('grows with the strength up to full volume', () => {
    expect(impactGain(0.5)).toBeLessThan(impactGain(3));
    expect(impactGain(3)).toBeLessThan(impactGain(8));
    expect(impactGain(12)).toBe(1);
    expect(impactGain(40)).toBe(1);
  });

  it('is silent for zero, negative and non-finite strength', () => {
    for (const strength of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(impactGain(strength)).toBe(0);
    }
  });
});

describe('createSound', () => {
  it('plays nothing before a gesture unlocks audio', () => {
    const { sound, context } = setup();
    sound.launch('coin');
    sound.impact('coin', 10);
    expect(sound.state()).toBe('locked');
    expect(context.started).toBe(0);
  });

  it('unlocks on a gesture and plays the launch that the same tap started', async () => {
    const { sound, context, states } = setup();
    sound.unlock();
    sound.launch('coin');
    expect(context.started).toBe(0);
    await flush();
    expect(states).toEqual(['running']);
    expect(context.started).toBeGreaterThan(0);
    const afterLaunch = context.started;
    sound.impact('die', 8);
    expect(context.started).toBeGreaterThan(afterLaunch);
  });

  it('stays locked when the browser refuses to resume, and tries again on the next gesture', async () => {
    const { sound, context } = setup();
    context.resumeResult = 'reject';
    sound.unlock();
    sound.launch('die');
    await flush();
    expect(sound.state()).toBe('locked');
    expect(context.started).toBe(0);

    context.resumeResult = 'resolve';
    sound.unlock();
    await flush();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(sound.state()).toBe('running');
  });

  it('goes locked when the browser suspends a running context', async () => {
    const { sound, context } = setup();
    sound.unlock();
    await flush();
    expect(sound.state()).toBe('running');
    context.state = 'suspended';
    context.onstatechange?.();
    expect(sound.state()).toBe('locked');
  });

  it('is unavailable without Web Audio or when creating the context throws, and stops trying', () => {
    const missing = vi.fn(() => null);
    const none = setup({ createContext: missing });
    none.sound.unlock();
    none.sound.unlock();
    expect(none.sound.state()).toBe('unavailable');
    expect(missing).toHaveBeenCalledTimes(1);

    const throwing = setup({
      createContext: () => {
        throw new DOMException('blocked', 'NotAllowedError');
      },
    });
    throwing.sound.unlock();
    expect(throwing.sound.state()).toBe('unavailable');
    expect(() => throwing.sound.impact('coin', 9)).not.toThrow();
  });

  it('vibrates on the first hit of each toss only, even without audio', () => {
    const { sound, vibrate } = setup({ createContext: () => null });
    sound.unlock();
    sound.launch('coin');
    sound.impact('coin', 9);
    sound.impact('coin', 4);
    expect(vibrate).toHaveBeenCalledTimes(1);
    sound.launch('coin');
    sound.impact('coin', 9);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('does not fail where vibration is missing', () => {
    const { sound } = setup({ vibrate: null });
    sound.launch('die');
    expect(() => sound.impact('die', 5)).not.toThrow();
  });

  it('plays and vibrates nothing while switched off, and resumes when switched on', async () => {
    const { sound, context, vibrate } = setup({ enabled: false });
    sound.unlock();
    await flush();
    sound.launch('coin');
    sound.impact('coin', 10);
    sound.settle('coin');
    expect(context.started).toBe(0);
    expect(vibrate).not.toHaveBeenCalled();

    sound.setEnabled(true);
    sound.launch('coin');
    sound.impact('coin', 10);
    expect(context.started).toBeGreaterThan(0);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('merges hits closer than 30 ms and skips silent ones', async () => {
    const { sound, context } = setup();
    sound.unlock();
    await flush();
    sound.impact('die', 6);
    const one = context.started;
    sound.impact('die', 6);
    expect(context.started).toBe(one);
    context.currentTime = 0.05;
    sound.impact('die', 0);
    expect(context.started).toBe(one);
    sound.impact('die', 6);
    expect(context.started).toBe(2 * one);
  });
});
