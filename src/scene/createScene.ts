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
import { computeCameraParams } from './camera';

// Must match the body background in style.css, which shows before the first frame.
const CLEAR_COLOR = 0x1c1d1f;
const TABLE_COLOR = 0x3b3d40;
const TABLE_SIZE = 1000;
const MAX_PIXEL_RATIO = 2;

export interface SceneHandle {
  start(): void;
  stop(): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement, onFirstFrame: () => void): SceneHandle {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(CLEAR_COLOR);

  const scene = new Scene();

  const tableGeometry = new PlaneGeometry(TABLE_SIZE, TABLE_SIZE);
  const tableMaterial = new MeshStandardMaterial({ color: TABLE_COLOR, roughness: 0.9 });
  const table = new Mesh(tableGeometry, tableMaterial);
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  scene.add(new HemisphereLight(0xffffff, 0x404040, 1.2));

  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(3, 10, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 4;
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  scene.add(sun);

  const camera = new PerspectiveCamera(50, 1, 0.1, TABLE_SIZE / 2);

  function resize(): void {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);

    const aspect = width / height;
    const params = computeCameraParams(aspect);
    camera.fov = params.fov;
    camera.aspect = aspect;
    camera.position.set(...params.position);
    camera.lookAt(...params.lookAt);
    camera.updateProjectionMatrix();
  }

  resize();
  window.addEventListener('resize', resize);

  let firstFrameDone = false;
  function renderFrame(): void {
    renderer.render(scene, camera);
    if (!firstFrameDone) {
      firstFrameDone = true;
      onFirstFrame();
    }
  }

  return {
    start() {
      renderer.setAnimationLoop(renderFrame);
    },
    stop() {
      renderer.setAnimationLoop(null);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      tableGeometry.dispose();
      tableMaterial.dispose();
      sun.shadow.dispose();
      renderer.dispose();
    },
  };
}
