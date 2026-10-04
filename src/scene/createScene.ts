import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { computeCameraParams, type CameraParams, type Vec3 } from './camera';
import { applyDolly } from './dolly';

// Keep in sync with theme-color in index.html and the body background in style.css,
// which shows before the first frame.
const CLEAR_COLOR = 0x1c1d1f;
const TABLE_COLOR = 0x3b3d40;
const TABLE_SIZE = 1000;
const MAX_PIXEL_RATIO = 2;

export interface SceneHandle {
  scene: Scene;
  start(): void;
  stop(): void;
  /** Runs before every render with the animation frame timestamp in ms. */
  onFrame(callback: (nowMs: number) => void): void;
  /** Moves the camera toward `target` by `amount` (0..1) of the dolly distance. */
  setDolly(target: Vec3, amount: number): void;
}

export function createScene(canvas: HTMLCanvasElement, onFirstFrame: () => void): SceneHandle {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(CLEAR_COLOR);

  const scene = new Scene();

  const table = new Mesh(
    new PlaneGeometry(TABLE_SIZE, TABLE_SIZE),
    new MeshStandardMaterial({ color: TABLE_COLOR, roughness: 0.9 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  scene.add(new HemisphereLight(0xffffff, 0x404040, 1.2));

  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(3, 10, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 4;
  // Without bias the thin coin's own faces show shadow-acne stripes.
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  scene.add(sun);

  const camera = new PerspectiveCamera(50, 1, 0.1, TABLE_SIZE / 2);
  let baseParams: CameraParams = computeCameraParams(1);
  let dollyTarget: Vec3 = [0, 0, 0];
  let dollyAmount = 0;

  function placeCamera(): void {
    const params = applyDolly(baseParams, dollyTarget, dollyAmount);
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

    const aspect = width / height;
    baseParams = computeCameraParams(aspect);
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
    onFrame(callback) {
      frameCallback = callback;
    },
    setDolly(target, amount) {
      dollyTarget = target;
      dollyAmount = amount;
    },
    start() {
      renderer.setAnimationLoop(renderFrame);
    },
    stop() {
      renderer.setAnimationLoop(null);
    },
  };
}
