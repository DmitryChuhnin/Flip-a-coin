import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';
import { cross, dot3, type Vec3 } from '../math/quat';
import { centroid, sub } from '../math/polyhedron';
import { UNDERLINE, type DieFaceArt, type DieModel } from './dieSpec';

const BODY_COLOR = 0xe6e1d6;
const BODY_CSS = '#e6e1d6';
const INK_CSS = '#26282c';
/** Texture density; at 128 px per cell the large d4 faces blurred on a phone after the dolly. */
const PX_PER_UNIT = 220;
const MIN_CELL_PX = 128;
const ROUGHNESS = 0.75;

export interface AtlasLayout {
  columns: number;
  rows: number;
}

export function atlasLayout(faces: number): AtlasLayout {
  const columns = Math.ceil(Math.sqrt(faces));
  return { columns, rows: Math.ceil(faces / columns) };
}

/** Texture coordinates of a face point in its atlas cell; v runs up as in three.js. */
export function faceUv(
  art: DieFaceArt,
  face: number,
  layout: AtlasLayout,
  p: Vec3,
): [number, number] {
  const d = sub(p, art.center);
  const cu = 0.5 + dot3(d, art.u) / (2 * art.half);
  const cv = 0.5 + dot3(d, art.v) / (2 * art.half);
  const column = face % layout.columns;
  const row = Math.floor(face / layout.columns);
  return [(column + cu) / layout.columns, 1 - (row + 1 - cv) / layout.rows];
}

/**
 * Flat-shaded geometry of the cut hull: group 0 holds the numbered faces, group 1 the bevels.
 * Triangles are wound outward, checked against the direction from the center.
 */
export function createDieGeometry(die: DieModel): BufferGeometry {
  const { shape, art } = die;
  const layout = atlasLayout(art.length);
  const positions: number[] = [];
  const uvs: number[] = [];
  const pushPolygon = (indices: number[], uvOf: (p: Vec3) => [number, number]) => {
    const points = indices.map((i) => shape.points[i]!);
    const middle = centroid(points);
    for (let i = 1; i + 1 < points.length; i += 1) {
      let triangle = [points[0]!, points[i]!, points[i + 1]!];
      const normal = cross(sub(triangle[1]!, triangle[0]!), sub(triangle[2]!, triangle[0]!));
      if (dot3(normal, middle) < 0) triangle = [triangle[0]!, triangle[2]!, triangle[1]!];
      for (const p of triangle) {
        positions.push(...p);
        uvs.push(...uvOf(p));
      }
    }
  };

  shape.faces.forEach((face, f) => pushPolygon(face, (p) => faceUv(art[f]!, f, layout, p)));
  const faceVertices = positions.length / 3;
  shape.bevels.forEach((bevel) => pushPolygon(bevel, () => [0, 0]));

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.addGroup(0, faceVertices, 0);
  geometry.addGroup(faceVertices, positions.length / 3 - faceVertices, 1);
  return geometry;
}

function paintAtlas(die: DieModel): HTMLCanvasElement {
  const layout = atlasLayout(die.art.length);
  const largest = Math.max(...die.art.map((art) => art.half));
  const cellPx = Math.max(MIN_CELL_PX, Math.ceil(2 * largest * PX_PER_UNIT));
  const canvas = document.createElement('canvas');
  canvas.width = layout.columns * cellPx;
  canvas.height = layout.rows * cellPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available for the die numbers');
  ctx.fillStyle = BODY_CSS;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK_CSS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  die.art.forEach((art, f) => {
    const pxPerUnit = cellPx / (2 * art.half);
    const left = (f % layout.columns) * cellPx;
    const top = Math.floor(f / layout.columns) * cellPx;
    for (const label of art.labels) {
      const height = label.height * pxPerUnit;
      ctx.font = `bold 100px system-ui, sans-serif`;
      const sample = ctx.measureText(label.text);
      // Digit height is the ascent above the baseline; the font size is scaled to match it.
      const size = (100 * height) / Math.max(1, sample.actualBoundingBoxAscent);
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      const maxWidth = label.maxWidth * pxPerUnit;
      const width = Math.min(maxWidth, ctx.measureText(label.text).width);
      ctx.save();
      ctx.translate(
        left + (0.5 + label.x / (2 * art.half)) * cellPx,
        top + (0.5 - label.y / (2 * art.half)) * cellPx,
      );
      // Canvas y runs down, so the face-frame up vector (x, y) is (x, -y) on the canvas.
      ctx.rotate(Math.atan2(label.up[0], label.up[1]));
      ctx.fillText(label.text, 0, height / 2, maxWidth);
      if (label.underline) {
        const { gap, thickness } = UNDERLINE;
        ctx.fillRect(-width / 2, height / 2 + height * gap, width, height * thickness);
      }
      ctx.restore();
    }
  });
  return canvas;
}

export function createDieMesh(die: DieModel): Mesh {
  const texture = new CanvasTexture(paintAtlas(die));
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new Mesh(createDieGeometry(die), [
    new MeshStandardMaterial({ map: texture, roughness: ROUGHNESS, metalness: 0 }),
    new MeshStandardMaterial({ color: BODY_COLOR, roughness: ROUGHNESS, metalness: 0 }),
  ]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
