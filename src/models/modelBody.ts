import { Vector3 } from 'three';
import { ConvexHull, type Face as HullFace } from 'three/examples/jsm/math/ConvexHull.js';
import { cross, dot3, fromTo, length3, rotate, type Quat, type Vec3 } from '../math/quat';
import { rotationGroup } from '../math/symmetry';
import { bodyReach, defineBody, hullVectors, type TossBody } from '../toss/body';
import { upFace, type Face } from '../toss/faces';

/** What a model file gives for its body, in the file's frame and units. */
export interface ModelShape {
  /** Mesh points, origin at the center of mass; the body is their convex hull. */
  points: readonly Vec3[];
  /** The `faces` custom property as read: an array, or a JSON string of one. */
  faces: unknown;
}

export interface ModelBody<V extends string> {
  body: TossBody<V>;
  /** Factor from the file's units to the game's; the visual is drawn at it too. */
  scale: number;
}

/** The hull check in `defineBody` uses the same share of the reach, so every symmetry passes it. */
const SYMMETRY_TOLERANCE = 1e-5;
/** Points this share of the reach off a plane lie in it: on the table or in a flat mesh. */
const PLANE_TOLERANCE = 1e-5;
/** Hull triangles turned less than 1e-3 rad from each other lie in one flat side. */
const SIDE_COS = Math.cos(1e-3);
/** A side the body rests on has at least this share of the reach squared as its area. */
const MIN_SIDE_AREA = 1e-3;
/** Finding the symmetries costs the square of the corner count per rotation. */
const MAX_CORNERS = 256;

/**
 * Body of a model item, checked against the procedural item it replaces (`template`): the same
 * outcomes, and the template's reach, density and launch, so profiles, camera and walls fit it.
 * Throws a RangeError for a model that breaks the format.
 */
export function modelBody<V extends string>(
  shape: ModelShape,
  template: TossBody<V>,
): ModelBody<V> {
  const faces = readFaces(shape.faces, template.faces);
  const { points } = shape;
  if (points.length < 4 || !points.every((p) => p.every(Number.isFinite))) {
    throw new RangeError('The collider needs at least four finite points');
  }
  const modelReach = Math.max(...points.map(length3));
  if (!(modelReach > 0)) throw new RangeError('The collider has no size');
  const corners = hullCorners(points, PLANE_TOLERANCE * modelReach);
  if (corners.length > MAX_CORNERS) {
    throw new RangeError(`The collider has ${corners.length} corners, more than ${MAX_CORNERS}`);
  }
  const scale = bodyReach(template.hull) / modelReach;
  const hull = new Float32Array(corners.flatMap((p) => p.map((v) => v * scale)));
  const vectors = hullVectors(hull);
  const reach = bodyReach(hull);

  // The model starts with the same outcome up as the procedural item; a missing one fails below.
  const start = template.faces[upFace(template.initialPose.quaternion, template.faces).index]!;
  const top = faces.find((face) => face.value === start.value)?.normal ?? [0, 1, 0];
  const quaternion = fromTo(top, [0, 1, 0]);
  const lowest = Math.min(...vectors.map((p) => rotate(quaternion, p)[1]));
  const [x, , z] = template.initialPose.position;

  const body = defineBody({
    hull,
    density: template.density,
    faces,
    symmetries: rotationGroup(vectors, SYMMETRY_TOLERANCE),
    clearance: template.clearance,
    initialPose: { position: [x, -lowest, z], quaternion },
    launch: {
      ...template.launch,
      touchdown: { flat: -lowest, edge: template.launch.touchdown.edge },
    },
  });
  // The symmetries carry every face onto the start one, so checking it covers them all.
  checkRest(vectors, quaternion, reach, start.value);
  return { body, scale };
}

function readFaces<V extends string>(raw: unknown, expected: readonly Face<V>[]): Face<V>[] {
  if (raw === undefined) throw new RangeError('The model has no faces property');
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      throw new RangeError('The faces property is not valid JSON');
    }
  }
  if (!Array.isArray(list)) {
    throw new RangeError('The faces property must be an array or a JSON string of one');
  }
  if (list.length !== expected.length) {
    throw new RangeError(`The model has ${list.length} faces, the item has ${expected.length}`);
  }
  const values = new Map<string, V>(expected.map((face) => [face.value, face.value]));
  return list.map((entry: unknown, i) => {
    const given = field(entry, 'value');
    // A JSON number written in Blender reads as the die's value.
    const key = Number.isInteger(given) ? String(given) : given;
    const value = typeof key === 'string' ? values.get(key) : undefined;
    if (value === undefined) {
      const known = [...values.keys()].join(', ');
      throw new RangeError(`Face ${i} has value ${JSON.stringify(given)}, not one of ${known}`);
    }
    const normal = field(entry, 'normal');
    if (
      !Array.isArray(normal) ||
      normal.length !== 3 ||
      !normal.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new RangeError(`Face ${i} normal must be three finite numbers`);
    }
    return { value, normal: [normal[0], normal[1], normal[2]] };
  });
}

function field(entry: unknown, key: string): unknown {
  return typeof entry === 'object' && entry !== null
    ? (entry as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Hull points where three or more flat sides meet. Points inside a side or on an edge, such as
 * the outline of an engraved number, would break the symmetry and add nothing to the shape.
 */
function hullCorners(points: readonly Vec3[], tolerance: number): Vec3[] {
  // Such points have no hull with volume, and ConvexHull fails on them without saying why.
  const a = points[0]!;
  const b = farthest(points, (p) => length3(sub(p, a)));
  const along = sub(b, a);
  const c = farthest(points, (p) => length3(cross(along, sub(p, a))));
  const normal = cross(along, sub(c, a));
  if (!(length3(normal) > tolerance * length3(along))) {
    throw new RangeError('The collider points lie on one line');
  }
  const d = farthest(points, (p) => Math.abs(dot3(normal, sub(p, a))));
  if (!(Math.abs(dot3(normal, sub(d, a))) > tolerance * length3(normal))) {
    throw new RangeError('The collider is flat');
  }

  const hull = new ConvexHull().setFromPoints(points.map((p) => new Vector3(...p)));
  // Larger triangles go first: their directions are the most exact.
  const sides: Vector3[] = [];
  const sideOf = new Map<HullFace, Vector3>();
  for (const face of [...hull.faces].sort((x, y) => y.area - x.area)) {
    let side = sides.find((normal) => normal.dot(face.normal) >= SIDE_COS);
    if (!side) sides.push((side = face.normal));
    sideOf.set(face, side);
  }
  const sidesAt = new Map<Vector3, Set<Vector3>>();
  for (const face of hull.faces) {
    for (const v of faceVertices(face)) {
      const set = sidesAt.get(v) ?? new Set<Vector3>();
      sidesAt.set(v, set.add(sideOf.get(face)!));
    }
  }
  return [...sidesAt].filter(([, set]) => set.size >= 3).map(([p]): Vec3 => [p.x, p.y, p.z]);
}

function faceVertices(face: HullFace): Vector3[] {
  const vertices: Vector3[] = [];
  let edge = face.edge;
  do {
    vertices.push(edge.head().point);
    edge = edge.next;
  } while (edge !== face.edge);
  return vertices;
}

function farthest(points: readonly Vec3[], distance: (p: Vec3) => number): Vec3 {
  return points.reduce((best, p) => (distance(p) > distance(best) ? p : best));
}

/** Throws unless the lowest hull points span a side with the center of mass above it. */
function checkRest(points: readonly Vec3[], q: Quat, reach: number, value: string): void {
  const turned = points.map((p) => rotate(q, p));
  const lowest = Math.min(...turned.map((p) => p[1]));
  const contact = turned
    .filter((p) => p[1] - lowest <= PLANE_TOLERANCE * reach)
    .map((p): [number, number] => [p[0], p[2]]);
  const ring = outline(contact);
  const area = ring.reduce((sum, p, i) => sum + turn([0, 0], p, ring[(i + 1) % ring.length]!), 0);
  if (!(area / 2 >= MIN_SIDE_AREA * reach * reach)) {
    throw new RangeError(`With ${value} up the model does not rest on a flat side`);
  }
  // The origin is the center of mass; a body with it outside the side tips over.
  const margin = PLANE_TOLERANCE * reach;
  const above = ring.every((p, i) => {
    const next = ring[(i + 1) % ring.length]!;
    return turn(p, next, [0, 0]) >= margin * Math.hypot(next[0] - p[0], next[1] - p[1]);
  });
  if (!above) {
    throw new RangeError(`With ${value} up the center of mass is outside the side it rests on`);
  }
}

/** Convex outline of points in a plane, counterclockwise. */
function outline(points: readonly [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const chain = (list: readonly [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...chain(sorted), ...chain([...sorted].reverse())];
}

/** Twice the signed area of the triangle (a, b, c); positive when it turns counterclockwise. */
function turn(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  return (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
