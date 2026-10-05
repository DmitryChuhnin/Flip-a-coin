import type { Object3D } from 'three';
import type { Item } from './items';
import type { Pose } from './math/quat';
import type { ContactShadow } from './scene/contactShadow';
import type { SceneHandle } from './scene/createScene';
import {
  cameraAt,
  closeUpView,
  flightCorners,
  flightView,
  holdShot,
  isShotMoving,
  LAUNCH_SHOT_S,
  SETTLE_SHOT_S,
  type Shot,
} from './scene/shots';
import { bodyReach, hullVectors } from './toss/body';
import type { TossEngine } from './toss/engine';
import type { TossPlan } from './toss/planToss';
import { FrameClock, visualPose } from './toss/playback';

/** `error`: the physics engine failed to load or a plan broke its contract; tossing stays off. */
export type TossState = 'loading' | 'idle' | 'flying' | 'result' | 'error';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  scene: SceneHandle;
  item: Item;
  /** Drawn object; its pose is set from the toss plan. */
  model: Object3D;
  /** Spot under the model that shows its height above the table. */
  shadow: ContactShadow;
  /** Polite live region that announces the result. */
  announcer: HTMLElement;
  /** Large result text above the table, hidden while the item has none to show. */
  caption: HTMLElement;
  loadEngine: () => Promise<TossEngine>;
  reducedMotion: () => boolean;
}

export interface Game {
  /** Call when the render loop restarts after a pause, so the flight resumes without a jump. */
  resume(): void;
}

export function startGame(options: GameOptions): Game {
  const { canvas, scene, item, model, shadow, announcer, caption, reducedMotion } = options;
  const clock = new FrameClock();
  let state: TossState = 'loading';
  let engine: TossEngine | null = null;
  let plan: TossPlan<string> | null = null;
  let flightS = 0;
  let nowS = 0;
  let rest: Pose = item.body.initialPose;
  const hull = hullVectors(item.body.hull);
  const reach = bodyReach(item.body.hull);
  let shot: Shot = holdShot(closeUpView(rest.position, reach));
  let tossCount = 0;

  function setState(next: TossState): void {
    state = next;
    document.body.dataset.tossState = next;
  }

  function place(pose: Pose): void {
    model.position.set(...pose.position);
    model.quaternion.set(...pose.quaternion);
    const [x, y, z] = pose.position;
    shadow.follow(x, z, y - item.body.launch.touchdown.flat);
  }

  function fail(error: unknown): void {
    setState('error');
    console.error(error);
  }

  function showCaption(text: string | null): void {
    caption.textContent = text ?? '';
    caption.hidden = text === null;
  }

  function toss(): void {
    if (!engine || (state !== 'idle' && state !== 'result')) return;
    if (isShotMoving(shot, nowS, reducedMotion())) return;
    try {
      plan = engine.plan(item.body, rest, reducedMotion());
    } catch (error) {
      fail(error);
      return;
    }
    flightS = 0;
    tossCount += 1;
    document.body.dataset.tossCount = String(tossCount);
    announcer.textContent = '';
    showCaption(null);
    shot = {
      from: closeUpView(rest.position, reach),
      to: flightView(flightCorners(plan, hull)),
      startS: nowS,
      durationS: LAUNCH_SHOT_S,
    };
    setState('flying');
  }

  function land(landed: TossPlan<string>): void {
    rest = visualPose(landed, landed.durationS);
    place(rest);
    shot = {
      from: shot.to,
      to: closeUpView(rest.position, reach),
      startS: nowS,
      durationS: SETTLE_SHOT_S,
    };
    announcer.textContent = item.announce(landed.outcome);
    showCaption(item.caption(landed.outcome));
    setState('result');
  }

  scene.onFrame((nowMs) => {
    const dt = clock.tick(nowMs);
    nowS += dt;
    if (state === 'flying' && plan) {
      flightS = Math.min(flightS + dt, plan.durationS);
      if (flightS >= plan.durationS) {
        land(plan);
      } else {
        place(visualPose(plan, flightS));
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

  place(rest);
  showCaption(null);
  document.body.dataset.item = item.name;
  document.body.dataset.tossCount = '0';
  setState('loading');
  options.loadEngine().then((loaded) => {
    try {
      loaded.prepare(item.body);
    } catch (error) {
      fail(error);
      return;
    }
    engine = loaded;
    setState('idle');
  }, fail);

  return {
    resume() {
      clock.reset();
    },
  };
}
