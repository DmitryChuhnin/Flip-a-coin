import {
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { computeCameraParams, type CameraParams } from './camera';
import { buildStudio } from './studio';

const FAR_PLANE = 500;
const MAX_PIXEL_RATIO = 2;

export interface SceneHandle {
  scene: Scene;
  /** Adds the tossed item; its standard materials get the studio reflections. */
  addItem(item: Object3D): void;
  start(): void;
  stop(): void;
  /** Runs before every render with the animation frame timestamp in ms. */
  onFrame(callback: (nowMs: number) => void): void;
  /** Canvas width over height. */
  aspect(): number;
  /** Camera for the next render. */
  setCamera(params: CameraParams): void;
}

export function createScene(canvas: HTMLCanvasElement, onFirstFrame: () => void): SceneHandle {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = SRGBColorSpace;

  const scene = new Scene();
  const environment = buildStudio(scene, renderer);

  const camera = new PerspectiveCamera(50, 1, 0.1, FAR_PLANE);
  let aspect = 1;
  let params: CameraParams = computeCameraParams(aspect);

  function placeCamera(): void {
    camera.fov = params.fov;
    camera.position.set(...params.position);
    camera.lookAt(...params.lookAt);
    camera.updateProjectionMatrix();
  }

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);

    aspect = width / height;
    camera.aspect = aspect;
    placeCamera();
  }

  resize();
  window.addEventListener('resize', resize);

  let frameCallback: ((nowMs: number) => void) | null = null;
  let firstFrameDone = false;
  function renderFrame(nowMs: number): void {
    frameCallback?.(nowMs);
    placeCamera();
    renderer.render(scene, camera);
    if (!firstFrameDone) {
      firstFrameDone = true;
      onFirstFrame();
    }
  }

  return {
    scene,
    addItem(item) {
      item.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const materials: unknown[] = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          if (material instanceof MeshStandardMaterial) material.envMap = environment;
        }
      });
      scene.add(item);
    },
    onFrame(callback) {
      frameCallback = callback;
    },
    aspect() {
      return aspect;
    },
    setCamera(next) {
      params = next;
    },
    start() {
      renderer.setAnimationLoop(renderFrame);
    },
    stop() {
      renderer.setAnimationLoop(null);
    },
  };
}
