import {
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from 'three';

// Lilac seamless studio. Keep FLOOR_COLOR in sync with theme-color in index.html and the body
// background in style.css, which show before the first frame.
export const FLOOR_COLOR = '#c9b9f8';
const GROUND_COLOR = '#bba9f3';
const ENV_BOTTOM = '#e2d9fc';

/** Floor length in front of the cove, cove radius and back wall height, world units. */
const FLOOR = 40;
const COVE_RADIUS = 12;
const WALL = 40;
/** Where the floor starts to bend up: behind the far wall of the play zone. */
const COVE_Z = -4;
const WIDTH = 200;

/**
 * Floor, a quarter-circle cove and a back wall as one surface, so no horizon line shows behind
 * the table at any aspect.
 */
function cyclorama(): Mesh {
  const geometry = new PlaneGeometry(WIDTH, 1, 1, 160);
  const p = geometry.attributes.position!;
  const arc = (Math.PI * COVE_RADIUS) / 2;
  const length = FLOOR + arc + WALL;
  for (let i = 0; i < p.count; i += 1) {
    const d = (p.getY(i) + 0.5) * length;
    let y: number;
    let z: number;
    if (d < FLOOR) {
      y = 0;
      z = COVE_Z + FLOOR - d;
    } else if (d < FLOOR + arc) {
      const a = (d - FLOOR) / COVE_RADIUS;
      y = COVE_RADIUS * (1 - Math.cos(a));
      z = COVE_Z - COVE_RADIUS * Math.sin(a);
    } else {
      y = COVE_RADIUS + d - FLOOR - arc;
      z = COVE_Z - COVE_RADIUS;
    }
    p.setXYZ(i, p.getX(i), y, z);
  }
  geometry.computeVertexNormals();
  return new Mesh(geometry, new MeshLambertMaterial({ color: FLOOR_COLOR, side: DoubleSide }));
}

/** Soft gradient room with two white panels; only metals and glossy plastics reflect it. */
function environment(renderer: WebGLRenderer): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available for the environment map');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(1, ENV_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;

  const room = new Scene();
  room.add(
    new Mesh(
      new SphereGeometry(10, 32, 16),
      new MeshBasicMaterial({ side: BackSide, map: texture }),
    ),
  );
  for (const [x, y, z] of [
    [-6, 6, 3],
    [6, 4, -4],
  ] as const) {
    const panel = new Mesh(
      new PlaneGeometry(6, 3),
      new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide }),
    );
    panel.position.set(x, y, z);
    panel.lookAt(0, 0, 0);
    room.add(panel);
  }

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.04);
  pmrem.dispose();
  room.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      object.material.map?.dispose();
      object.material.dispose();
    }
  });
  return target.texture;
}

// Intensities were picked on a three.js r128 stand with legacy lights, which scaled every light
// by π; physically based lights here need the factor written out.
const LEGACY = Math.PI;

/**
 * Fills `scene` with the studio and returns its environment map. The map goes on the item's
 * materials only: as `scene.environment` it would also light the Lambert floor, which the stand
 * (three.js r128) did not do.
 */
export function buildStudio(scene: Scene, renderer: WebGLRenderer): Texture {
  scene.background = new Color(FLOOR_COLOR);
  scene.add(cyclorama());
  scene.add(new HemisphereLight(0xffffff, GROUND_COLOR, 0.6 * LEGACY));

  const sun = new DirectionalLight(0xfff8f0, 0.5 * LEGACY);
  sun.position.set(1.2, 9, 2.6);
  const rim = new DirectionalLight(0xffe0f0, 0.35 * LEGACY);
  rim.position.set(-4, 3, -6);
  const fill = new DirectionalLight(0xffffff, 0.18 * LEGACY);
  fill.position.set(0, 2, 10);
  scene.add(sun, rim, fill);
  return environment(renderer);
}
