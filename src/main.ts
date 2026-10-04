import './style.css';
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

function startScene(canvas: HTMLCanvasElement): void {
  let scene: SceneHandle;
  try {
    scene = createScene(canvas, () => {
      document.body.dataset.sceneReady = 'true';
    });
  } catch {
    showWebGLError();
    return;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      scene.stop();
    } else {
      scene.start();
    }
  });

  if (!document.hidden) {
    scene.start();
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');

if (canvas && hasWebGL2()) {
  startScene(canvas);
} else {
  showWebGLError();
}
