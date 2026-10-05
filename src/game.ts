import type { Object3D } from 'three';
import type { Item, ItemName } from './items';
import type { Pose, Vec3 } from './math/quat';
import { STEP_S, stillSinceS } from './physics/frames';
import type { ContactShadow } from './scene/contactShadow';
import type { SceneHandle } from './scene/createScene';
import {
  cameraAt,
  closeUpView,
  easeOutCubic,
  flightCorners,
  flightView,
  holdShot,
  isShotMoving,
  LAUNCH_SHOT_S,
  SETTLE_SHOT_S,
  type Shot,
  type View,
} from './scene/shots';
import type { TossEngine } from './toss/engine';
import type { TossPlan } from './toss/planToss';
import { FrameClock, visualPose } from './toss/playback';

/** `error`: the physics engine failed to load or a plan broke its contract; tossing stays off. */
export type TossState = 'loading' | 'idle' | 'flying' | 'result' | 'error';

/** The old item shrinks away in the first half, the new one grows in the second. */
export const SWAP_S = 0.28;

export interface LoadedItem {
  item: Item;
  /** Drawn object; its pose is set from the toss plan. */
  model: Object3D;
  hull: readonly Vec3[];
  /** Distance from the center to the farthest hull point. */
  reach: number;
}

export interface GameOptions {
  canvas: HTMLCanvasElement;
  scene: Pick<SceneHandle, 'onFrame' | 'aspect' | 'setCamera' | 'addItem' | 'removeItem'>;
  /** Spot under the model that shows its height above the table. */
  shadow: ContactShadow;
  /** Polite live region that announces the result. */
  announcer: HTMLElement;
  /** Large result text above the table, hidden while the item has none to show. */
  caption: HTMLElement;
  initialItem: ItemName;
  /** Returns the item with its model; may return the same object for repeated names. */
  loadItem: (name: ItemName) => LoadedItem;
  loadEngine: () => Promise<TossEngine>;
  reducedMotion: () => boolean;
  onStateChange?: (state: TossState) => void;
  /** Runs when a toss starts. */
  onToss?: (item: ItemName) => void;
  /** Runs when playback passes a recorded table hit; `strength` is its approach speed. */
  onImpact?: (item: ItemName, strength: number) => void;
  /** Runs when playback reaches the moment the body stops moving, before the camera settles. */
  onRest?: (item: ItemName) => void;
}

export interface Game {
  /** Call when the render loop restarts after a pause, so the flight resumes without a jump. */
  resume(): void;
  /** Puts another item on the table; ignored in flight, queued while a swap runs. */
  selectItem(name: ItemName): void;
}

interface Swap {
  from: LoadedItem;
  fromPose: Pose;
  startS: number;
  /** Whether the new model has replaced the old one in the scene. */
  shown: boolean;
}

export function startGame(options: GameOptions): Game {
  const { canvas, scene, shadow, announcer, caption, reducedMotion } = options;
  const clock = new FrameClock();
  let state: TossState = 'loading';
  let engine: TossEngine | null = null;
  let current = options.loadItem(options.initialItem);
  let plan: TossPlan<string> | null = null;
  let flightS = 0;
  /** Flight time the body stops moving at; the recording runs on while the engine confirms rest. */
  let restS = 0;
  let rested = false;
  let nowS = 0;
  let rest: Pose = current.item.body.initialPose;
  let shot: Shot = holdShot(closeUpView(rest.position, current.reach));
  let swap: Swap | null = null;
  let pending: ItemName | null = null;
  let tossCount = 0;

  function setState(next: TossState): void {
    state = next;
    document.body.dataset.tossState = next;
    options.onStateChange?.(next);
  }

  function place(shown: LoadedItem, pose: Pose, size = 1): void {
    shown.model.position.set(...pose.position);
    shown.model.quaternion.set(...pose.quaternion);
    shown.model.scale.setScalar(Math.max(size, 0.001));
    const [x, y, z] = pose.position;
    shadow.follow(x, z, y - shown.item.body.launch.touchdown.flat, size);
  }

  function fail(error: unknown): void {
    setState('error');
    console.error(error);
  }

  function showCaption(text: string | null): void {
    if (text !== null) caption.textContent = text;
    caption.hidden = text === null;
  }

  function prepare(body: Item['body']): void {
    try {
      engine?.prepare(body);
    } catch (error) {
      fail(error);
    }
  }

  /** The camera as it stands now, wherever a move has got to. */
  function cameraNow(): View {
    const frozen = shot;
    const at = nowS;
    return (aspect) => cameraAt(frozen, at, aspect, false);
  }

  function toss(): void {
    if (!engine || swap || (state !== 'idle' && state !== 'result')) return;
    if (isShotMoving(shot, nowS, reducedMotion())) return;
    try {
      plan = engine.plan(current.item.body, rest, reducedMotion());
    } catch (error) {
      fail(error);
      return;
    }
    flightS = 0;
    restS = stillSinceS(plan.frames);
    rested = false;
    tossCount += 1;
    document.body.dataset.tossCount = String(tossCount);
    announcer.textContent = '';
    showCaption(null);
    shot = {
      from: closeUpView(rest.position, current.reach),
      to: flightView(flightCorners(plan, current.hull)),
      startS: nowS,
      durationS: LAUNCH_SHOT_S,
    };
    setState('flying');
    options.onToss?.(current.item.name);
  }

  function land(landed: TossPlan<string>): void {
    rest = visualPose(landed, landed.durationS);
    place(current, rest);
    shot = {
      from: shot.to,
      to: closeUpView(rest.position, current.reach),
      startS: nowS,
      durationS: SETTLE_SHOT_S,
    };
    announcer.textContent = current.item.announce(landed.outcome);
    showCaption(current.item.caption(landed.outcome));
    setState('result');
  }

  function selectItem(name: ItemName): void {
    if (state === 'flying') return;
    if (swap) {
      pending = name;
      return;
    }
    if (name === current.item.name) return;
    let next: LoadedItem;
    try {
      next = options.loadItem(name);
    } catch (error) {
      fail(error);
      return;
    }
    swap = { from: current, fromPose: rest, startS: nowS, shown: false };
    current = next;
    rest = next.item.body.initialPose;
    shot = {
      from: cameraNow(),
      to: closeUpView(rest.position, next.reach),
      startS: nowS,
      durationS: SWAP_S,
    };
    announcer.textContent = '';
    showCaption(null);
    document.body.dataset.item = name;
    if (state === 'result') setState('idle');
  }

  function stepSwap(active: Swap): void {
    const k = reducedMotion() ? 1 : Math.min(1, (nowS - active.startS) / SWAP_S);
    if (k < 0.5) {
      place(active.from, active.fromPose, 1 - easeOutCubic(k * 2));
      return;
    }
    if (!active.shown) {
      scene.removeItem(active.from.model);
      active.from.model.scale.setScalar(1);
      shadow.setReach(current.reach);
      scene.addItem(current.model);
      active.shown = true;
    }
    place(current, rest, easeOutCubic((k - 0.5) * 2));
    if (k < 1) return;
    swap = null;
    prepare(current.item.body);
    const queued = pending;
    pending = null;
    if (queued !== null) selectItem(queued);
  }

  scene.onFrame((nowMs) => {
    const dt = clock.tick(nowMs);
    nowS += dt;
    if (swap) stepSwap(swap);
    if (state === 'flying' && plan) {
      const fromS = flightS;
      flightS = Math.min(flightS + dt, plan.durationS);
      for (const contact of plan.contacts) {
        const atS = contact.frame * STEP_S;
        if (atS > fromS && atS <= flightS) options.onImpact?.(current.item.name, contact.strength);
      }
      if (!rested && flightS >= restS) {
        rested = true;
        options.onRest?.(current.item.name);
      }
      if (flightS >= plan.durationS) {
        land(plan);
      } else {
        place(current, visualPose(plan, flightS));
      }
    }
    scene.setCamera(cameraAt(shot, nowS, scene.aspect(), reducedMotion()));
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.isPrimary && event.button === 0) toss();
  });
  window.addEventListener('keydown', (event) => {
    if (event.repeat || (event.code !== 'Space' && event.key !== 'Enter')) return;
    // Space and Enter on a focused control belong to that control.
    if (event.target !== document.body || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    toss();
  });

  shadow.setReach(current.reach);
  scene.addItem(current.model);
  place(current, rest);
  showCaption(null);
  document.body.dataset.item = current.item.name;
  document.body.dataset.tossCount = '0';
  setState('loading');
  options.loadEngine().then((loaded) => {
    engine = loaded;
    // A running swap records the fallback when it ends.
    if (!swap) prepare(current.item.body);
    if (state === 'loading') setState('idle');
  }, fail);

  return {
    resume() {
      clock.reset();
    },
    selectItem,
  };
}
