import {
  add,
  chamfer,
  centroid,
  convexFaces,
  faceNormal,
  scale,
  sub,
  unit,
  type Chamfered,
  type Polyhedron,
} from '../math/polyhedron';
import {
  cross,
  dot3,
  fromAxisAngle,
  fromTo,
  length3,
  multiply,
  rotate,
  type Pose,
  type Vec3,
} from '../math/quat';
import { rotationGroup } from '../math/symmetry';
import { defineBody, hullVectors, type TossBody } from '../toss/body';
import type { Face } from '../toss/faces';
import { DIE_PROFILE, DIE_REDUCED_PROFILE } from '../toss/profiles';

// Every die is a convex polyhedron centered at the origin, with edges and corners cut by
// `chamfer`. The cut hull is both the collider and the drawn mesh.

export const DIE_KINDS = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;
export type DieKind = (typeof DIE_KINDS)[number];

export interface DieLabel {
  text: string;
  /** Label center in the face frame, world units. */
  x: number;
  y: number;
  /** Direction of the top of the text in the face frame. */
  up: readonly [x: number, y: number];
  /** Digit height, world units. */
  height: number;
  /** Widest text that stays on the cut face, world units; wider text is squeezed to it. */
  maxWidth: number;
  /** 6 and 9 are underlined so they cannot be mistaken for each other. */
  underline: boolean;
}

/** Texture layout of one face: a square of the face plane with side 2·half around `center`. */
export interface DieFaceArt {
  center: Vec3;
  /** Face frame axes; u × v is the outward normal, so text is not mirrored. */
  u: Vec3;
  v: Vec3;
  half: number;
  labels: DieLabel[];
}

export interface DieModel {
  kind: DieKind;
  sides: number;
  body: TossBody<string>;
  /** Cut polyhedron; `faces[i]` is drawn with `art[i]`. */
  shape: Chamfered;
  art: DieFaceArt[];
}

interface DieShape {
  sides: number;
  vertices: Vec3[];
  /** Share of each face corner cut toward the face center. */
  cut: number;
  /** Digit height as a share of the face inradius at the label. */
  textScale: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const DENSITY = 1;
/** A die is up to 1.5 units tall; this keeps one leaning on a side wall inside the frame. */
const WALL_INSET = 0.15;
/** Where a die rests before the first toss, as the coin does. */
const START: Vec3 = [0, 0, 1];

function scaledTo(points: Vec3[], radius: number): Vec3[] {
  const reach = Math.max(...points.map(length3));
  return points.map((p) => scale(p, radius / reach));
}

function signs(count: number): number[][] {
  return Array.from({ length: 2 ** count }, (_, i) =>
    Array.from({ length: count }, (_, b) => ((i >> b) & 1 ? -1 : 1)),
  );
}

/** Pentagonal trapezohedron: poles on Y and two staggered rings, kites planar by construction. */
function trapezohedron(ringRadius: number, poleHeight: number): Vec3[] {
  const c = Math.cos(Math.PI / 5);
  const ringHeight = (poleHeight * (1 - c)) / (1 + c);
  const ring = (offset: number, y: number): Vec3[] =>
    Array.from({ length: 5 }, (_, k) => {
      const a = ((2 * k + offset) * Math.PI) / 5;
      return [ringRadius * Math.cos(a), y, ringRadius * Math.sin(a)];
    });
  return [[0, poleHeight, 0], [0, -poleHeight, 0], ...ring(0, ringHeight), ...ring(1, -ringHeight)];
}

const SHAPES: Record<DieKind, () => DieShape> = {
  d4: () => ({
    sides: 4,
    vertices: scaledTo(
      [
        [1, 1, 1],
        [1, -1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
      ],
      1.05,
    ),
    cut: 0.1,
    textScale: 0.7,
  }),
  d6: () => ({
    sides: 6,
    vertices: scaledTo(
      signs(3).map(([x, y, z]) => [x!, y!, z!]),
      0.85,
    ),
    cut: 0.12,
    textScale: 1.05,
  }),
  d8: () => ({
    sides: 8,
    vertices: scaledTo(
      [0, 1, 2].flatMap((axis) =>
        [1, -1].map((s): Vec3 => [axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0]),
      ),
      0.85,
    ),
    cut: 0.1,
    textScale: 1.1,
  }),
  d10: () => ({
    sides: 10,
    vertices: trapezohedron(0.78, 0.82),
    cut: 0.1,
    textScale: 0.95,
  }),
  d12: () => ({
    sides: 12,
    vertices: scaledTo(
      [
        ...signs(3).map(([x, y, z]): Vec3 => [x!, y!, z!]),
        ...signs(2).flatMap(([a, b]): Vec3[] => [
          [0, a! / PHI, b! * PHI],
          [a! / PHI, b! * PHI, 0],
          [a! * PHI, 0, b! / PHI],
        ]),
      ],
      0.85,
    ),
    cut: 0.1,
    textScale: 1.0,
  }),
  d20: () => ({
    sides: 20,
    vertices: scaledTo(
      signs(2).flatMap(([a, b]): Vec3[] => [
        [0, a!, b! * PHI],
        [a!, b! * PHI, 0],
        [a! * PHI, 0, b!],
      ]),
      0.9,
    ),
    cut: 0.1,
    textScale: 0.95,
  }),
};

/**
 * Values with opposite faces summing to sides + 1. Faces are taken from the top down; the first
 * of each opposite pair gets the next odd value, so odd numbers share a hemisphere as on a d10.
 */
function oppositeValues(normals: Vec3[]): number[] {
  const sides = normals.length;
  const order = normals
    .map((n, i) => ({ i, y: n[1], a: Math.atan2(n[2], n[0]) }))
    .sort((p, q) => (Math.abs(p.y - q.y) > 1e-9 ? q.y - p.y : p.a - q.a));
  const values = new Array<number>(sides).fill(0);
  let pair = 0;
  for (const { i } of order) {
    if (values[i]) continue;
    const opposite = normals.findIndex((m) => length3(sub(m, scale(normals[i]!, -1))) < 1e-9);
    if (opposite < 0) throw new Error(`Face ${i} has no opposite face`);
    values[i] = 2 * pair + 1;
    values[opposite] = sides - 2 * pair;
    pair += 1;
  }
  return values;
}

/** Signed distance from `p` to the nearest edge line of a counter-clockwise face, inside positive. */
function edgeClearance(p: Vec3, corners: Vec3[], normal: Vec3): number {
  return Math.min(
    ...corners.map((a, i) => {
      const b = corners[(i + 1) % corners.length]!;
      return dot3(sub(p, a), unit(cross(normal, sub(b, a))));
    }),
  );
}

/** Point on the line from `from` through `through` farthest from the edges (golden section). */
function deepestOnLine(from: Vec3, through: Vec3, corners: Vec3[], normal: Vec3): Vec3 {
  const at = (t: number) => sub(from, scale(sub(from, through), 2 * t));
  const g = (Math.sqrt(5) - 1) / 2;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (edgeClearance(at(a), corners, normal) < edgeClearance(at(b), corners, normal)) lo = a;
    else hi = b;
  }
  return at((lo + hi) / 2);
}

function label(
  text: string,
  at: Vec3,
  up: Vec3,
  height: number,
  frame: Pick<DieFaceArt, 'center' | 'u' | 'v'>,
): DieLabel {
  const d = sub(at, frame.center);
  return {
    text,
    x: dot3(d, frame.u),
    y: dot3(d, frame.v),
    up: [dot3(up, frame.u), dot3(up, frame.v)],
    height,
    maxWidth: 0,
    underline: text === '6' || text === '9',
  };
}

/** Underline band below the digits, in digit heights; `dieMesh` draws it there. */
export const UNDERLINE = { gap: 0.12, thickness: 0.1 } as const;
const LABEL_MARGIN = 0.95;

/**
 * Twice the shortest distance, along the text line, from the label axis to the polygon edge over
 * the label's height. The polygon is convex, so checking the top and bottom lines is enough.
 */
function fitWidth(label: DieLabel, polygon: [number, number][]): number {
  const mx = polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length;
  const my = polygon.reduce((sum, [, y]) => sum + y, 0) / polygon.length;
  const [ux, uy] = label.up;
  const below = label.underline ? UNDERLINE.gap + UNDERLINE.thickness : 0;
  let half = Infinity;
  for (const t of [label.height / 2, -label.height * (0.5 + below)]) {
    const px = label.x + t * ux;
    const py = label.y + t * uy;
    polygon.forEach(([ax, ay], i) => {
      const [bx, by] = polygon[(i + 1) % polygon.length]!;
      // Inward edge normal; the text runs along (uy, -ux).
      const flip = (ay - by) * (mx - ax) + (bx - ax) * (my - ay) < 0 ? -1 : 1;
      const nx = flip * (ay - by);
      const ny = flip * (bx - ax);
      const inside = nx * (px - ax) + ny * (py - ay);
      const along = Math.abs(nx * uy - ny * ux);
      if (inside < 0) half = 0;
      else if (along > 1e-12) half = Math.min(half, inside / along);
    });
  }
  return 2 * half * LABEL_MARGIN;
}

function faceArt(
  corners: Vec3[],
  normal: Vec3,
  texts: (vertex: number) => string,
  shape: DieShape,
  perVertex: boolean,
): DieFaceArt {
  const middle = centroid(corners);
  const reach = (c: Vec3) => length3(sub(c, middle));
  const isSquare =
    corners.length === 4 && corners.every((c) => Math.abs(reach(c) - reach(corners[0]!)) < 1e-9);
  // Text points to the farthest corner (the pole on a d10 kite) or along a d6 edge.
  const far = corners.reduce((best, c) => (reach(c) > reach(best) + 1e-9 ? c : best));
  const target = isSquare ? centroid([corners[0]!, corners[1]!]) : far;
  const center = perVertex || isSquare ? middle : deepestOnLine(far, middle, corners, normal);
  const v = unit(sub(target, center));
  const frame = { center, u: cross(v, normal), v };
  const half = Math.max(...corners.map((c) => length3(sub(c, center))));
  const inradius = edgeClearance(center, corners, normal) * (1 - shape.cut);

  const labels = perVertex
    ? corners.map((corner, i) => {
        const toward = unit(sub(corner, center));
        return label(
          texts(i),
          add(center, scale(toward, inradius * 1.05)),
          toward,
          inradius * shape.textScale,
          frame,
        );
      })
    : [label(texts(0), center, v, inradius * shape.textScale, frame)];
  const cutCorners = corners.map((c) => add(c, scale(sub(middle, c), shape.cut)));
  const polygon = cutCorners.map((c): [number, number] => {
    const d = sub(c, center);
    return [dot3(d, frame.u), dot3(d, frame.v)];
  });
  return {
    ...frame,
    half,
    labels: labels.map((l) => ({ ...l, maxWidth: fitWidth(l, polygon) })),
  };
}

/** Rest pose on the table with local `top` up and local `forward` turned toward the viewer (+Z). */
function restPose(points: Vec3[], top: Vec3, forward: Vec3): Pose {
  const tilt = fromTo(top, [0, 1, 0]);
  const f = rotate(tilt, forward);
  const quaternion = multiply(fromAxisAngle([0, 1, 0], -Math.atan2(f[0], f[2])), tilt);
  const lowest = Math.min(...points.map((p) => rotate(quaternion, p)[1]));
  return { position: [START[0], -lowest, START[2]], quaternion };
}

export function createDie(kind: DieKind): DieModel {
  const shape = SHAPES[kind]();
  const polyhedron: Polyhedron = { vertices: shape.vertices, faces: convexFaces(shape.vertices) };
  const isD4 = kind === 'd4';
  if (polyhedron.faces.length !== shape.sides) {
    throw new Error(`${kind} has ${polyhedron.faces.length} faces, expected ${shape.sides}`);
  }
  const cornersOf = (face: readonly number[]) => face.map((i) => shape.vertices[i]!);
  const normals = polyhedron.faces.map((face) => faceNormal(cornersOf(face)));

  // A d4 rests on a face and reads the number at the top vertex, so its outcomes are vertices.
  const values = isD4 ? shape.vertices.map((_, i) => i + 1) : oppositeValues(normals);
  const faces: Face<string>[] = isD4
    ? shape.vertices.map((p, i) => ({ value: String(values[i]), normal: unit(p) }))
    : normals.map((normal, i) => ({ value: String(values[i]), normal }));

  const cut = chamfer(polyhedron, shape.cut);
  const hull = new Float32Array(cut.points.flat());
  const art = polyhedron.faces.map((face, f) =>
    faceArt(
      cornersOf(face),
      normals[f]!,
      (i) => String(isD4 ? values[face[i]!] : values[f]),
      shape,
      isD4,
    ),
  );

  const points = hullVectors(hull);
  const reach = Math.max(...points.map(length3));
  const topIndex = values.indexOf(shape.sides);
  const top = faces[topIndex]!.normal;
  // d4: a side face looks at the viewer; others: the top number reads upright.
  const forward = isD4
    ? normals.find((n) => dot3(n, top) < 0.9 && dot3(n, top) > -0.9)!
    : scale(art[topIndex]!.v, -1);
  const initialPose = restPose(points, top, forward);
  const lowest = Math.min(...points.map((p) => rotate(initialPose.quaternion, p)[1]));

  const body = defineBody({
    hull,
    density: DENSITY,
    faces,
    symmetries: rotationGroup(shape.vertices),
    clearance: reach + 0.01,
    initialPose,
    launch: {
      profiles: [DIE_PROFILE],
      reduced: DIE_REDUCED_PROFILE,
      touchdown: { flat: -lowest, edge: reach },
      fallback: { lift: 9, halfTurns: [3, 4, 2, 5, 6] },
      wallInset: WALL_INSET,
    },
  });
  return { kind, sides: shape.sides, body, shape: cut, art };
}
