import {
  BufferGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  Vector2,
  type ExtrudeGeometryOptions,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  APOTHEM,
  FACE_HEIGHT,
  octagonAngles,
  RIM_INNER_APOTHEM,
  RIM_OUTER_APOTHEM,
  SIDE_HALF_HEIGHT,
  THICKNESS,
} from './coinSpec';

const COIN_COLOR = 0xb4b7bb;
/** Small bevel that catches light on every relief edge. */
const RELIEF_BEVEL = 0.007;
const RIM_HEIGHT = THICKNESS / 2 - FACE_HEIGHT;
const CAT_HEIGHT = 0.02;
const NOSE_HEIGHT = 0.008;
const DIGIT_HEIGHT = 0.024;

// Shape coordinates are drawn as seen on the face: +x right, +y away from the viewer.
// Heads maps shape (x, y) to local (x, ·, -y); tails, seen after a half-turn about X, to (x, ·, y).

function octagonPoints(apothem: number): Vector2[] {
  const radius = apothem / Math.cos(Math.PI / 8);
  // The angle set is symmetric under a -> -a, so this works for both face mappings.
  return octagonAngles().map((a) => new Vector2(radius * Math.cos(a), radius * Math.sin(a)));
}

function catHead(): Shape {
  const cx = 0;
  const cy = -0.05;
  const r = 0.25;
  const at = (deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const shape = new Shape();
  shape.moveTo(...at(25));
  shape.lineTo(0.23, 0.33);
  shape.lineTo(...at(72));
  shape.absarc(cx, cy, r, (72 * Math.PI) / 180, (108 * Math.PI) / 180, false);
  shape.lineTo(-0.23, 0.33);
  shape.lineTo(...at(155));
  shape.absarc(cx, cy, r, (155 * Math.PI) / 180, (385 * Math.PI) / 180, false);
  return shape;
}

function catNose(): Shape {
  const shape = new Shape();
  shape.absellipse(0, -0.06, 0.1, 0.075, 0, Math.PI * 2, false, 0);
  return shape;
}

function digitOne(): Shape {
  return new Shape()
    .moveTo(-0.15, -0.31)
    .lineTo(0.15, -0.31)
    .lineTo(0.15, -0.23)
    .lineTo(0.055, -0.23)
    .lineTo(0.055, 0.31)
    .lineTo(-0.03, 0.31)
    .lineTo(-0.17, 0.17)
    .lineTo(-0.12, 0.11)
    .lineTo(-0.055, 0.18)
    .lineTo(-0.055, -0.23)
    .lineTo(-0.15, -0.23);
}

/**
 * Extrudes `shape` outward from a face: from `base` to `base + height` above the heads face
 * (side 1) or below the tails face (side -1), bevel included.
 */
function relief(
  shapes: Shape | Shape[],
  base: number,
  height: number,
  side: 1 | -1,
  bevel = RELIEF_BEVEL,
): BufferGeometry {
  const options: ExtrudeGeometryOptions = {
    depth: height - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  };
  const geometry = new ExtrudeGeometry(shapes, options);
  // Extrusion runs along +Z from -bevel to depth + bevel.
  geometry.translate(0, 0, bevel);
  geometry.rotateX(side === 1 ? -Math.PI / 2 : Math.PI / 2);
  geometry.translate(0, side * base, 0);
  return geometry;
}

function body(): BufferGeometry {
  const chamfer = FACE_HEIGHT - SIDE_HALF_HEIGHT;
  const geometry = new ExtrudeGeometry(new Shape(octagonPoints(APOTHEM - chamfer)), {
    depth: 2 * SIDE_HALF_HEIGHT,
    bevelEnabled: true,
    bevelThickness: chamfer,
    bevelSize: chamfer,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -SIDE_HALF_HEIGHT);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function rim(side: 1 | -1): BufferGeometry {
  const ring = new Shape(octagonPoints(RIM_OUTER_APOTHEM - RELIEF_BEVEL));
  ring.holes.push(new Path(octagonPoints(RIM_INNER_APOTHEM + RELIEF_BEVEL)));
  // Starts inside the face so no seam shows at the base.
  return relief(ring, FACE_HEIGHT - 0.002, RIM_HEIGHT + 0.002, side);
}

export function createCoinGeometry(): BufferGeometry {
  const parts = [
    body(),
    rim(1),
    rim(-1),
    relief(catHead(), FACE_HEIGHT - 0.002, CAT_HEIGHT + 0.002, 1),
    relief(catNose(), FACE_HEIGHT + CAT_HEIGHT - 0.002, NOSE_HEIGHT + 0.002, 1, 0.003),
    relief(digitOne(), FACE_HEIGHT - 0.002, DIGIT_HEIGHT + 0.002, -1),
  ];
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('Coin geometry parts have mismatched attributes');
  return merged;
}

export function createCoinMesh(): Mesh {
  const mesh = new Mesh(
    createCoinGeometry(),
    new MeshStandardMaterial({ color: COIN_COLOR, roughness: 0.6, metalness: 0.3 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
