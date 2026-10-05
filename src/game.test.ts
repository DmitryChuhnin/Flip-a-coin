// @vitest-environment happy-dom
import { Object3D } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startGame,
  SWAP_S,
  type Game,
  type GameOptions,
  type LoadedItem,
  type TossState,
} from './game';
import type { ItemName } from './items';
import { IDENTITY, type Vec3 } from './math/quat';
import { FRAME_STRIDE } from './physics/frames';
import type { ContactShadow } from './scene/contactShadow';
import { SETTLE_SHOT_S } from './scene/shots';
import type { TossEngine } from './toss/engine';
import type { TossPlan } from './toss/planToss';

const FRAME_MS = 16;
const HULL: Vec3[] = [
  [0.5, 0, 0],
  [-0.5, 0, 0],
  [0, 0.1, 0],
  [0, -0.1, 0],
  [0, 0, 0.5],
  [0, 0, -0.5],
];

function loadedItem(name: ItemName): LoadedItem {
  return {
    item: {
      name,
      body: {
        initialPose: { position: [0, 0.1, 1], quaternion: IDENTITY },
        launch: { touchdown: { flat: 0.1, edge: 0.5 } },
      } as unknown as LoadedItem['item']['body'],
      createMesh: () => new Object3D(),
      announce: (outcome) => `Got ${outcome}`,
      caption: (outcome) => (name === 'coin' ? null : outcome),
    },
    model: new Object3D(),
    hull: HULL,
    reach: 0.5,
  };
}

/** A straight-up hop from (0, 0.1, 1) over `seconds`. */
function hop(seconds: number): TossPlan<string> {
  const count = Math.round(seconds * 60) + 1;
  const frames = new Float32Array(count * FRAME_STRIDE);
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    frames.set([0, 0.1 + 4 * t * (1 - t), 1, ...IDENTITY], i * FRAME_STRIDE);
  }
  return {
    outcome: '7',
    frames,
    contacts: [],
    visualOffset: IDENTITY,
    blend: { startS: 0, endS: 0 },
    durationS: (count - 1) / 60,
    profile: 'normal',
    attempts: 1,
    usedFallback: false,
  };
}

interface Harness {
  api: Game;
  options: GameOptions;
  engine: { prepare: ReturnType<typeof vi.fn>; plan: ReturnType<typeof vi.fn> };
  states: TossState[];
  items: Map<ItemName, LoadedItem>;
  scene: { addItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
  /** Runs `seconds` of animation frames. */
  run(seconds: number): void;
  tap(): void;
  key(init: KeyboardEventInit, target?: EventTarget): void;
  state(): string | undefined;
  tosses(): string | undefined;
}

let nowMs = 0;

function harness(overrides: Partial<GameOptions> = {}): Harness {
  let frame: (ms: number) => void = () => {};
  const items = new Map<ItemName, LoadedItem>();
  const engine = { prepare: vi.fn(), plan: vi.fn(() => hop(1)) };
  const states: TossState[] = [];
  const scene = { addItem: vi.fn(), removeItem: vi.fn() };
  const shadow: ContactShadow = {
    mesh: new Object3D() as ContactShadow['mesh'],
    setReach: vi.fn(),
    follow: vi.fn(),
  };
  const canvas = document.createElement('canvas');
  const options: GameOptions = {
    canvas,
    scene: {
      ...scene,
      onFrame: (callback) => {
        frame = callback;
      },
      aspect: () => 9 / 19.5,
      setCamera: vi.fn(),
    },
    shadow,
    announcer: document.createElement('p'),
    caption: document.createElement('p'),
    initialItem: 'coin',
    loadItem: (name) => {
      let item = items.get(name);
      if (!item) {
        item = loadedItem(name);
        items.set(name, item);
      }
      return item;
    },
    loadEngine: () => Promise.resolve(engine as unknown as TossEngine),
    reducedMotion: () => false,
    onStateChange: (state) => states.push(state),
    ...overrides,
  };
  const api = startGame(options);
  return {
    api,
    options,
    engine,
    states,
    items,
    scene,
    run(seconds) {
      for (let t = 0; t < seconds * 1000; t += FRAME_MS) {
        nowMs += FRAME_MS;
        frame(nowMs);
      }
    },
    tap() {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, button: 0 }));
    },
    key(init, target = document.body) {
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    },
    state: () => document.body.dataset.tossState,
    tosses: () => document.body.dataset.tossCount,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
  for (const key of Object.keys(document.body.dataset)) delete document.body.dataset[key];
});

describe('startGame', () => {
  it('ignores taps until the engine has loaded', async () => {
    let resolve: (engine: TossEngine) => void = () => {};
    const game = harness({ loadEngine: () => new Promise((r) => (resolve = r)) });
    game.run(0.1);
    game.tap();
    game.key({ code: 'Space' });
    expect(game.state()).toBe('loading');
    expect(game.tosses()).toBe('0');

    resolve(game.engine as unknown as TossEngine);
    await flush();
    expect(game.state()).toBe('idle');
    game.tap();
    expect(game.tosses()).toBe('1');
  });

  it('stays in error with tossing off when the engine fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const game = harness({ loadEngine: () => Promise.reject(new Error('no wasm')) });
    await flush();
    expect(game.state()).toBe('error');
    expect(game.states.at(-1)).toBe('error');
    game.tap();
    expect(game.tosses()).toBe('0');
  });

  it('goes to error when recording the fallback throws, and when planning throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failedPrepare = harness();
    failedPrepare.engine.prepare.mockImplementation(() => {
      throw new RangeError('bad body');
    });
    await flush();
    expect(failedPrepare.state()).toBe('error');

    const failedPlan = harness();
    failedPlan.engine.plan.mockImplementation(() => {
      throw 'not an Error';
    });
    await flush();
    failedPlan.tap();
    expect(failedPlan.state()).toBe('error');
    expect(failedPlan.tosses()).toBe('0');
    failedPlan.engine.plan.mockImplementation(() => hop(1));
    failedPlan.tap();
    expect(failedPlan.engine.plan).toHaveBeenCalledTimes(1);
  });

  it('starts one toss for a tap and a Space in the same frame', async () => {
    const game = harness();
    await flush();
    game.tap();
    game.key({ code: 'Space' });
    expect(game.tosses()).toBe('1');
    expect(game.engine.plan).toHaveBeenCalledTimes(1);
  });

  it('ignores a held key, a key with a modifier and a key on a focused control', async () => {
    const game = harness();
    await flush();
    game.key({ code: 'Space', repeat: true });
    game.key({ key: 'Enter', ctrlKey: true });
    game.key({ code: 'Space', metaKey: true });
    const button = document.createElement('button');
    document.body.append(button);
    game.key({ code: 'Space' }, button);
    expect(game.tosses()).toBe('0');
    game.key({ key: 'Enter' });
    expect(game.tosses()).toBe('1');
  });

  it('lands, announces and ignores a tap until the camera has settled', async () => {
    const game = harness({ initialItem: 'd6' });
    await flush();
    game.tap();
    expect(game.state()).toBe('flying');
    game.run(1.05);
    expect(game.state()).toBe('result');
    expect(game.options.announcer.textContent).toBe('Got 7');
    expect(game.options.caption.hidden).toBe(false);
    game.tap();
    expect(game.tosses()).toBe('1');
    game.run(SETTLE_SHOT_S);
    game.tap();
    expect(game.tosses()).toBe('2');
    expect(game.options.caption.hidden).toBe(true);
  });

  it('reports each recorded table hit once, in order, and the rest after the last one', async () => {
    const impacts: [string, number][] = [];
    const lands: string[] = [];
    const game = harness({
      initialItem: 'd6',
      onImpact: (item, strength) => impacts.push([item, strength]),
      onLand: (item) => lands.push(item),
    });
    game.engine.plan.mockImplementation(() => ({
      ...hop(1),
      contacts: [
        { frame: 20, strength: 9 },
        { frame: 27, strength: 2 },
        { frame: 45, strength: 0.5 },
      ],
    }));
    await flush();
    game.tap();
    game.run(0.25);
    expect(impacts).toEqual([]);
    game.run(0.1);
    expect(impacts).toEqual([['d6', 9]]);
    game.run(0.55);
    expect(impacts).toEqual([
      ['d6', 9],
      ['d6', 2],
      ['d6', 0.5],
    ]);
    expect(lands).toEqual([]);
    game.run(0.2);
    expect(lands).toEqual(['d6']);
    game.run(1);
    expect(impacts).toHaveLength(3);
    expect(lands).toHaveLength(1);
  });

  it('resumes a flight where it stopped after the tab was hidden', async () => {
    const game = harness();
    await flush();
    game.tap();
    game.run(0.3);
    const model = game.items.get('coin')!.model;
    const before = model.position.y;
    // The render loop restarts a minute later; the first frame after resume does not advance.
    game.api.resume();
    nowMs += 60_000;
    game.run(0.001);
    expect(model.position.y).toBe(before);
    expect(game.state()).toBe('flying');
    game.run(0.1);
    expect(model.position.y).not.toBe(before);
  });
});

describe('selectItem', () => {
  async function ready(overrides: Partial<GameOptions> = {}): Promise<Harness> {
    const game = harness(overrides);
    await flush();
    return game;
  }

  it('is ignored in flight', async () => {
    const game = await ready();
    game.tap();
    game.api.selectItem('d20');
    expect(document.body.dataset.item).toBe('coin');
    expect(game.items.has('d20')).toBe(false);
  });

  it('swaps the model halfway through the swap and clears the shown result', async () => {
    const game = await ready({ initialItem: 'd6' });
    game.tap();
    game.run(1.5);
    expect(game.state()).toBe('result');

    game.api.selectItem('d20');
    expect(game.state()).toBe('idle');
    expect(game.options.caption.hidden).toBe(true);
    expect(game.options.announcer.textContent).toBe('');
    expect(document.body.dataset.item).toBe('d20');
    game.tap();
    expect(game.tosses()).toBe('1');

    const d6 = game.items.get('d6')!.model;
    const d20 = game.items.get('d20')!.model;
    game.run(SWAP_S / 4);
    expect(game.scene.addItem).not.toHaveBeenCalledWith(d20);
    expect(d6.scale.x).toBeGreaterThan(0);
    expect(d6.scale.x).toBeLessThan(1);
    game.run(SWAP_S * 0.35);
    expect(game.scene.addItem).toHaveBeenCalledWith(d20);
    expect(d20.scale.x).toBeLessThan(1);
    expect(game.engine.prepare).toHaveBeenCalledTimes(1);
    game.run(SWAP_S);
    expect(game.scene.removeItem).toHaveBeenCalledWith(game.items.get('d6')!.model);
    expect(game.scene.addItem).toHaveBeenCalledWith(d20);
    expect(d20.scale.x).toBe(1);
    expect(game.engine.prepare).toHaveBeenCalledTimes(2);
    expect(game.engine.prepare.mock.lastCall![0]).toBe(game.items.get('d20')!.item.body);
    game.tap();
    expect(game.tosses()).toBe('2');
  });

  it('puts the last item picked during a swap on the table next', async () => {
    const game = await ready();
    game.api.selectItem('d6');
    game.api.selectItem('d8');
    game.api.selectItem('d12');
    game.run(SWAP_S * 3);
    expect(document.body.dataset.item).toBe('d12');
    expect(game.scene.addItem).toHaveBeenLastCalledWith(game.items.get('d12')!.model);
    expect(game.items.has('d8')).toBe(false);
  });

  it('swaps on the next frame under reduced motion', async () => {
    const game = await ready({ reducedMotion: () => true });
    game.api.selectItem('d4');
    // Before that frame the old model is still on the table.
    game.tap();
    expect(game.tosses()).toBe('0');
    game.run(0.001);
    expect(game.scene.addItem).toHaveBeenLastCalledWith(game.items.get('d4')!.model);
    game.tap();
    expect(game.tosses()).toBe('1');
  });

  it('records the fallback for an item picked while loading only when the swap ends', async () => {
    let resolve: (engine: TossEngine) => void = () => {};
    const game = harness({ loadEngine: () => new Promise((r) => (resolve = r)) });
    game.api.selectItem('d8');
    game.run(SWAP_S / 4);
    resolve(game.engine as unknown as TossEngine);
    await flush();
    expect(game.state()).toBe('idle');
    expect(game.engine.prepare).not.toHaveBeenCalled();
    game.run(SWAP_S);
    expect(game.engine.prepare).toHaveBeenCalledTimes(1);
    expect(game.engine.prepare.mock.lastCall![0]).toBe(game.items.get('d8')!.item.body);
  });

  it('goes to error when the item cannot be built', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const game = await ready({
      loadItem: (name) => {
        if (name === 'd10') throw new RangeError('bad die');
        return loadedItem(name);
      },
    });
    game.api.selectItem('d10');
    expect(game.state()).toBe('error');
    game.tap();
    expect(game.tosses()).toBe('0');
  });
});
