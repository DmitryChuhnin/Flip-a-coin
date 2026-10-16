import { Vector3 } from 'three';
import { ConvexHull, type Face as HullFace } from 'three/examples/jsm/math/ConvexHull.js';
import {
  conjugate,
  cross,
  dot3,
  fromTo,
  length3,
  multiply,
  normalize,
  rotate,
  type Quat,
  type Vec3,
} from '../math/quat';
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

/**
 * Rotations that map the corners and the face directions onto themselves to this share of the
 * reach count as symmetries, and both are made exactly symmetric. Mesh tools round positions.
 */
const SNAP_TOLERANCE = 1e-3;
/** Face normals must be unit to this, as in `defineBody`; only their directions are aligned. */
const UNIT_TOLERANCE = 1e-6;
/**
 * Points this share of the reach apart are one point, and this far off a plane lie in it: split
 * vertices, a flat mesh, a center of mass on an edge.
 */
const PLANE_TOLERANCE = 1e-5;
/** Hull triangles turned less than 1e-3 rad from each other lie in one flat side. */
const SIDE_COS = Math.cos(1e-3);
/** A side the body rests on has at least this share of the reach squared as its area. */
const MIN_SIDE_AREA = 1e-3;
/** A tilt this large about an edge of the side it rests on leaves the center of mass over it. */
const MIN_TIP_DEG = 5;
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
    throw new RangeError('The model needs at least four finite points');
  }
  // A visual can have more points than a spread call takes as arguments.
  const modelReach = points.reduce((max, p) => Math.max(max, length3(p)), 0);
  if (!(modelReach > 0)) throw new RangeError('The model has no size');
  const corners = hullCorners(
    distinct(points, PLANE_TOLERANCE * modelReach),
    PLANE_TOLERANCE * modelReach,
  );
  if (corners.length > MAX_CORNERS) {
    throw new RangeError(`The model has ${corners.length} corners, more than ${MAX_CORNERS}`);
  }
  const scale = bodyReach(template.hull) / modelReach;
  const scaled = corners.map((p): Vec3 => [p[0] * scale, p[1] * scale, p[2] * scale]);
  const { symmetries, corners: exact, faces: aligned } = symmetrize(scaled, faces);
  const hull = new Float32Array(exact.flat());
  const vectors = hullVectors(hull);
  const reach = bodyReach(hull);

  // The model starts with the same outcome up as the procedural item; a missing one fails below.
  const start = template.faces[upFace(template.initialPose.quaternion, template.faces).index]!;
  const top = aligned.find((face) => face.value === start.value)?.normal ?? [0, 1, 0];
  const quaternion = fromTo(top, [0, 1, 0]);
  const lowest = Math.min(...vectors.map((p) => rotate(quaternion, p)[1]));
  const [x, , z] = template.initialPose.position;

  const body = defineBody({
    hull,
    density: template.density,
    faces: aligned,
    symmetries,
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

/**
 * The rotations that map the corners onto themselves to SNAP_TOLERANCE, made into an exact group,
 * with the corners and the face directions averaged over it. Throws unless the group carries the
 * face directions onto each other and one face onto every other.
 */
function symmetrize<V extends string>(
  corners: readonly Vec3[],
  faces: readonly Face<V>[],
): { symmetries: Quat[]; corners: Vec3[]; faces: Face<V>[] } {
  const reach = corners.reduce((max, p) => Math.max(max, length3(p)), 0);
  // Rotations found to SNAP_TOLERANCE would take such corners for one another.
  const gap = corners.reduce(
    (min, p, i) => corners.slice(i + 1).reduce((m, q) => Math.min(m, length3(sub(p, q))), min),
    Infinity,
  );
  if (gap < 2 * SNAP_TOLERANCE * reach) {
    throw new RangeError(
      `The model has corners closer together than ${(2 * SNAP_TOLERANCE).toExponential()} of its size`,
    );
  }
  const found = rotationGroup(corners, SNAP_TOLERANCE);
  const near = nearestCorner(corners, SNAP_TOLERANCE * reach);
  const moves = found.map((q) => corners.map((p) => near(rotate(q, p))));
  // A rotation is fixed by where it sends two corners off one line through the origin.
  const n = corners.length;
  const a = corners.indexOf(farthest(corners, length3));
  const b = corners.indexOf(farthest(corners, (p) => length3(cross(corners[a]!, p))));
  const byKey = new Map(moves.map((move, i) => [move[a]! * n + move[b]!, i]));
  // product[h][g] is the index of the rotation h·g; it is missing when some rotation maps the
  // corners only to about SNAP_TOLERANCE.
  const product = moves.map((h) => moves.map((g) => byKey.get(h[g[a]!]! * n + h[g[b]!]!) ?? -1));
  if (product.some((row) => row.includes(-1))) {
    throw new RangeError('The model corners are too far off their symmetric places to align them');
  }

  // Averaging h⁻¹·(h·g) over the group takes a near group to an exact one, squaring its error;
  // a change too small for 1 - |cos| to show leaves an error below float precision.
  let group: Quat[] = found;
  for (let step = 0, change = 1; step < 8 && change > 0; step++) {
    const next = group.map((g, i) =>
      normalize(
        group.reduce<Quat>(
          (sum, h, j) => {
            const term = multiply(conjugate(h), group[product[j]![i]!]!);
            const sign = Math.sign(dot4(term, g)) || 1;
            return [
              sum[0] + sign * term[0],
              sum[1] + sign * term[1],
              sum[2] + sign * term[2],
              sum[3] + sign * term[3],
            ];
          },
          [0, 0, 0, 0],
        ),
      ),
    );
    change = next.reduce((max, q, i) => Math.max(max, 1 - Math.abs(dot4(q, group[i]!))), 0);
    group = next;
  }

  const average = (images: (q: Quat, k: number) => Vec3): Vec3 =>
    scaled3(
      group.reduce<Vec3>((sum, q, k) => add(sum, rotate(conjugate(q), images(q, k))), [0, 0, 0]),
      1 / group.length,
    );
  const exact = corners.map((_, i) => average((_, k) => corners[moves[k]![i]!]!));

  const normals = faces.map((face) => face.normal);
  // Aligning would hide a normal off unit length, so `defineBody` names it.
  if (!normals.every((n) => Math.abs(length3(n) - 1) <= UNIT_TOLERANCE)) {
    return { symmetries: group, corners: exact, faces: [...faces] };
  }
  const turns = group.map((q) => normals.map((n) => nearest(normals, rotate(q, n))));
  const carried = turns.every(
    (turn, k) =>
      new Set(turn).size === normals.length &&
      turn.every(
        (m, v) => length3(sub(rotate(group[k]!, normals[v]!), normals[m]!)) <= SNAP_TOLERANCE,
      ),
  );
  const tolerance = SNAP_TOLERANCE.toExponential();
  if (!carried) {
    throw new RangeError(
      `The face normals do not follow the symmetries of the corners to ${tolerance}`,
    );
  }
  const orbit = new Set(turns.map((turn) => turn[0]));
  const missing = faces.find((_, v) => !orbit.has(v));
  if (missing) {
    throw new RangeError(
      `No rotation that maps the model onto itself to ${tolerance} of its size carries the face of ${faces[0]!.value} onto the face of ${missing.value}`,
    );
  }
  const aligned = faces.map((face, v) => {
    const sum = average((_, k) => normals[turns[k]![v]!]!);
    return { value: face.value, normal: scaled3(sum, 1 / length3(sum)) };
  });
  return { symmetries: group, corners: exact, faces: aligned };
}

/** Finds the corner within `cell` of a point, or -1; comparing with every corner is too slow. */
function nearestCorner(corners: readonly Vec3[], cell: number): (target: Vec3) => number {
  const grid = pointGrid(
    cell,
    corners.reduce((max, p) => Math.max(max, length3(p)), 0),
  );
  corners.forEach((p, i) => grid.add(p, i));
  return grid.nearest;
}

/** The points without those closer than `tolerance` to an earlier one, such as split vertices. */
function distinct(points: readonly Vec3[], tolerance: number): Vec3[] {
  const reach = points.reduce((max, p) => Math.max(max, length3(p)), 0);
  // Cells this coarse keep the grid keys exact integers.
  const grid = pointGrid(Math.max(tolerance, reach / 1e5), reach);
  const kept: Vec3[] = [];
  for (const p of points) {
    const i = grid.nearest(p);
    if (i >= 0 && length3(sub(kept[i]!, p)) <= tolerance) continue;
    grid.add(p, kept.length);
    kept.push(p);
  }
  return kept;
}

/** Points filed by cubes of side `cell`; `nearest` finds the closest within `cell`, or -1. */
function pointGrid(cell: number, reach: number) {
  const half = Math.ceil(reach / cell) + 2;
  const index = (v: number) => Math.floor(v / cell) + half;
  const at = (x: number, y: number, z: number) => (x * (2 * half + 1) + y) * (2 * half + 1) + z;
  const cells = new Map<number, [Vec3, number][]>();
  return {
    add(p: Vec3, i: number): void {
      const key = at(index(p[0]), index(p[1]), index(p[2]));
      cells.set(key, [...(cells.get(key) ?? []), [p, i]]);
    },
    nearest(target: Vec3): number {
      const [x, y, z] = [index(target[0]), index(target[1]), index(target[2])];
      let best = -1;
      let distance = cell;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const [p, i] of cells.get(at(x + dx, y + dy, z + dz)) ?? []) {
              const d = length3(sub(p, target));
              if (d <= distance) [best, distance] = [i, d];
            }
          }
        }
      }
      return best;
    },
  };
}

function nearest(points: readonly Vec3[], target: Vec3): number {
  let best = 0;
  points.forEach((p, i) => {
    if (length3(sub(p, target)) < length3(sub(points[best]!, target))) best = i;
  });
  return best;
}

function dot4(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaled3(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k];
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
    throw new RangeError('The model points lie on one line');
  }
  const d = farthest(points, (p) => Math.abs(dot3(normal, sub(p, a))));
  if (!(Math.abs(dot3(normal, sub(d, a))) > tolerance * length3(normal))) {
    throw new RangeError('The model is flat');
  }

  const hull = new ConvexHull().setFromPoints(points.map((p) => new Vector3(...p)));
  // Larger triangles go first: their directions are the most exact.
  const sides: Vector3[] = [];
  const sideOf = new Map<HullFace, Vector3>();
  for (const face of [...hull.faces].sort((x, y) => y.area - x.area)) {
    let side = sides.find((normal) => normal.dot(face.normal) >= SIDE_COS);
    if (!side) {
      // A convex body with n corners has at most 2n - 4 sides; a smooth mesh stops here.
      if (sides.length === 2 * MAX_CORNERS - 4) {
        throw new RangeError(`The model has more than ${MAX_CORNERS} corners`);
      }
      sides.push((side = face.normal));
    }
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
  // Aligning keeps a side flat only where a symmetry turns it in place; a d10 side has none.
  const contact = turned
    .filter((p) => p[1] - lowest <= SNAP_TOLERANCE * reach)
    .map((p): [number, number] => [p[0], p[2]]);
  const ring = outline(contact);
  const area = ring.reduce((sum, p, i) => sum + turn([0, 0], p, ring[(i + 1) % ring.length]!), 0);
  if (!(area / 2 >= MIN_SIDE_AREA * reach * reach)) {
    throw new RangeError(`With ${value} up the model does not rest on a flat side`);
  }
  // The origin is the center of mass; this is its distance inside the nearest edge of the side.
  const inside = Math.min(
    ...ring.map((p, i) => {
      const next = ring[(i + 1) % ring.length]!;
      return turn(p, next, [0, 0]) / Math.hypot(next[0] - p[0], next[1] - p[1]);
    }),
  );
  if (!(inside >= PLANE_TOLERANCE * reach)) {
    throw new RangeError(`With ${value} up the center of mass is outside the side it rests on`);
  }
  // A truncated tip passes the checks above, but no toss comes to rest on it.
  if ((Math.atan2(inside, -lowest) * 180) / Math.PI < MIN_TIP_DEG) {
    throw new RangeError(
      `With ${value} up the model tips off the side it rests on at less than ${MIN_TIP_DEG}° of tilt`,
    );
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
