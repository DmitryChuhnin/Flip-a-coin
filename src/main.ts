import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import './style.css';
import { startGame, type LoadedItem } from './game';
import { createItem, type ItemName } from './items';
import { createContactShadow } from './scene/contactShadow';
import { createScene, type SceneHandle } from './scene/createScene';
import { itemOf, readSettings, writeSettings } from './settings';
import { STRINGS } from './strings';
import { bodyReach, hullVectors } from './toss/body';
import { bindControls, type Controls } from './ui/controls';

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

function storage(): Storage | null {
  return window.localStorage;
}

function showEngineError(): void {
  const panel = document.querySelector<HTMLElement>('#engine-error');
  if (!panel) return;
  panel.querySelector('p')!.textContent = STRINGS.engineError;
  const reload = panel.querySelector('button')!;
  reload.textContent = STRINGS.reload;
  reload.onclick = () => window.location.reload();
  panel.hidden = false;
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

  // Each item is built once; switching back reuses its model and symmetry tables.
  const loaded = new Map<ItemName, LoadedItem>();
  const loadItem = (name: ItemName): LoadedItem => {
    let entry = loaded.get(name);
    if (!entry) {
      const item = createItem(name);
      entry = {
        item,
        model: item.createMesh(),
        hull: hullVectors(item.body.hull),
        reach: bodyReach(item.body.hull),
      };
      loaded.set(name, entry);
    }
    return entry;
  };

  let settings = readSettings(storage);
  const shadow = createContactShadow();
  scene.scene.add(shadow.mesh);
  let controls: Controls | null = null;
  const game = startGame({
    canvas,
    scene,
    shadow,
    announcer,
    caption,
    initialItem: itemOf(settings),
    loadItem,
    // Separate chunk: the scene shows while the physics engine downloads.
    loadEngine: () => import('./toss/engine').then((engine) => engine.createTossEngine()),
    reducedMotion: prefersReducedMotion(),
    onStateChange: (state) => {
      controls?.setLocked(state === 'flying');
      if (state === 'error') showEngineError();
    },
    onToss: () => controls?.hideHint(),
  });
  controls = bindControls(document, settings, {
    onChange: (next) => {
      settings = next;
      writeSettings(storage, settings);
      game.selectItem(itemOf(settings));
    },
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
