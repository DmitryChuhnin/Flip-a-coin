import './style.css';
import { startGame } from './game';
import { createItem, itemFromQuery } from './items';
import { createScene, type SceneHandle } from './scene/createScene';

// Probed on a throwaway canvas: three.js r163+ needs WebGL2, and a failed WebGLRenderer
// constructor logs to console.error before throwing.
function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

function showWebGLError(): void {
  document.querySelector<HTMLElement>('#webgl-error')?.removeAttribute('hidden');
}

function prefersReducedMotion(): () => boolean {
  const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  return () => query?.matches ?? false;
}

function startScene(canvas: HTMLCanvasElement, announcer: HTMLElement, caption: HTMLElement): void {
  let scene: SceneHandle;
  try {
    scene = createScene(canvas, () => {
      document.body.dataset.sceneReady = 'true';
    });
  } catch {
    showWebGLError();
    return;
  }

  const item = createItem(itemFromQuery(window.location.search));
  const model = item.createMesh();
  scene.scene.add(model);
  const game = startGame({
    canvas,
    scene,
    item,
    model,
    announcer,
    caption,
    // Separate chunk: the scene shows while the physics engine downloads.
    loadEngine: () => import('./toss/engine').then((engine) => engine.createTossEngine()),
    reducedMotion: prefersReducedMotion(),
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      scene.stop();
    } else {
      game.resume();
      scene.start();
    }
  });

  if (!document.hidden) {
    scene.start();
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const announcer = document.querySelector<HTMLElement>('#toss-result');
const caption = document.querySelector<HTMLElement>('#roll-number');

if (canvas && announcer && caption && hasWebGL2()) {
  startScene(canvas, announcer, caption);
} else {
  showWebGLError();
}
