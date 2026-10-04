import type { Object3D } from 'three';
import { INITIAL_POSE, type CoinValue } from './coin/coinSpec';
import type { Pose } from './math/quat';
import type { Vec3 } from './scene/camera';
import type { SceneHandle } from './scene/createScene';
import { DOLLY_AT_REST, dollyAmount, isDollyMoving, retarget } from './scene/dolly';
import { STRINGS } from './strings';
import type { TossEngine } from './toss/engine';
import type { TossPlan } from './toss/planToss';
import { FrameClock, visualPose } from './toss/playback';

/** `error`: the physics engine failed to load or a plan broke its contract; tossing stays off. */
export type TossState = 'loading' | 'idle' | 'flying' | 'result' | 'error';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  scene: SceneHandle;
  coin: Object3D;
  /** Polite live region that announces the result. */
  announcer: HTMLElement;
  loadEngine: () => Promise<TossEngine>;
  reducedMotion: () => boolean;
}

export interface Game {
  /** Call when the render loop restarts after a pause, so the flight resumes without a jump. */
  resume(): void;
}

export function startGame(options: GameOptions): Game {
  const { canvas, scene, coin, announcer, reducedMotion } = options;
  const clock = new FrameClock();
  let state: TossState = 'loading';
  let engine: TossEngine | null = null;
  let plan: TossPlan<CoinValue> | null = null;
  let flightS = 0;
  let nowS = 0;
  let rest: Pose = INITIAL_POSE;
  let dolly = DOLLY_AT_REST;
  let dollyTarget: Vec3 = rest.position;
  let tossCount = 0;

  function setState(next: TossState): void {
    state = next;
    document.body.dataset.tossState = next;
  }

  function place(pose: Pose): void {
    coin.position.set(...pose.position);
    coin.quaternion.set(...pose.quaternion);
  }

  function fail(error: unknown): void {
    setState('error');
    console.error(error);
  }

  function toss(): void {
    if (!engine || (state !== 'idle' && state !== 'result')) return;
    if (isDollyMoving(dolly, nowS, reducedMotion())) return;
    try {
      plan = engine.plan(rest, reducedMotion());
    } catch (error) {
      fail(error);
      return;
    }
    flightS = 0;
    tossCount += 1;
    document.body.dataset.tossCount = String(tossCount);
    announcer.textContent = '';
    dolly = retarget(dolly, 0, nowS, reducedMotion());
    setState('flying');
  }

  function land(landed: TossPlan<CoinValue>): void {
    rest = visualPose(landed, landed.durationS);
    place(rest);
    dollyTarget = rest.position;
    dolly = retarget(dolly, 1, nowS, reducedMotion());
    announcer.textContent = STRINGS[landed.outcome];
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
    scene.setDolly(dollyTarget, dollyAmount(dolly, nowS, reducedMotion()));
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
  document.body.dataset.tossCount = '0';
  setState('loading');
  options.loadEngine().then((loaded) => {
    engine = loaded;
    setState('idle');
  }, fail);

  return {
    resume() {
      clock.reset();
    },
  };
}
