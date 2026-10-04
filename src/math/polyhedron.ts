import { cross, dot3, length3, type Vec3 } from './quat';

export interface Polyhedron {
  vertices: readonly Vec3[];
  /** Vertex indices of each face, counter-clockwise seen from outside. */
  faces: readonly (readonly number[])[];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}

export function unit(v: Vec3): Vec3 {
  return scale(v, 1 / length3(v));
}

export function centroid(points: readonly Vec3[]): Vec3 {
  return scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
}

/** Outward unit normal of a convex face given counter-clockwise. */
export function faceNormal(points: readonly Vec3[]): Vec3 {
  let n: Vec3 = [0, 0, 0];
  const c = centroid(points);
  points.forEach((p, i) => {
    n = add(n, cross(sub(p, c), sub(points[(i + 1) % points.length]!, c)));
  });
  return unit(n);
}

/** Orders points of one plane counter-clockwise around `normal`, seen from its tip. */
export function sortAround(points: readonly Vec3[], normal: Vec3): number[] {
  const c = centroid(points);
  const e1 = unit(sub(points[0]!, c));
  const e2 = cross(normal, e1);
  const angle = (p: Vec3) => Math.atan2(dot3(sub(p, c), e2), dot3(sub(p, c), e1));
  return points.map((_, i) => i).sort((a, b) => angle(points[a]!) - angle(points[b]!));
}

/** Faces of the convex hull of `vertices`, which must surround the origin and all lie on it. */
export function convexFaces(vertices: readonly Vec3[], tolerance = 1e-9): number[][] {
  const faces: number[][] = [];
  const normals: Vec3[] = [];
  const n = vertices.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      for (let k = j + 1; k < n; k += 1) {
        const [a, b, c] = [vertices[i]!, vertices[j]!, vertices[k]!];
        const raw = cross(sub(b, a), sub(c, a));
        if (length3(raw) < tolerance) continue;
        let normal = unit(raw);
        if (dot3(normal, a) < 0) normal = scale(normal, -1);
        const d = dot3(normal, a);
        if (vertices.some((v) => dot3(normal, v) > d + tolerance)) continue;
        if (normals.some((m) => length3(sub(m, normal)) < 1e-6)) continue;
        const on = vertices.flatMap((v, index) =>
          Math.abs(dot3(normal, v) - d) <= tolerance ? [index] : [],
        );
        const order = sortAround(
          on.map((index) => vertices[index]!),
          normal,
        );
        faces.push(order.map((o) => on[o]!));
        normals.push(normal);
      }
    }
  }
  return faces;
}

export interface Chamfered {
  /** One point per (face, corner): the corner moved toward the face center. */
  points: Vec3[];
  /** Point indices of each shrunk face, in the order of the source face. */
  faces: number[][];
  /** Strips along the source edges and small polygons at the source vertices. */
  bevels: number[][];
}

/**
 * Cuts edges and corners by moving every face corner a fraction `k` toward its face center.
 * The shrunk faces stay in their planes, edge strips are planar trapezoids, and corner polygons
 * are planar when the faces around a vertex are symmetric about it, as on the dice here.
 */
export function chamfer(polyhedron: Polyhedron, k: number): Chamfered {
  const { vertices } = polyhedron;
  const points: Vec3[] = [];
  const index = new Map<string, number>();
  const faces = polyhedron.faces.map((face, f) => {
    const center = centroid(face.map((v) => vertices[v]!));
    return face.map((v) => {
      const corner = vertices[v]!;
      index.set(`${f}:${v}`, points.length);
      points.push(add(corner, scale(sub(center, corner), k)));
      return points.length - 1;
    });
  });

  const bevels: number[][] = [];
  const at = (f: number, v: number) => index.get(`${f}:${v}`)!;
  polyhedron.faces.forEach((face, f) => {
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length]!;
      // Each edge runs a -> b in one face and b -> a in the other; take it once.
      if (a > b) return;
      const g = polyhedron.faces.findIndex(
        (other, o) => o !== f && other.includes(a) && other.includes(b),
      );
      bevels.push([at(f, a), at(f, b), at(g, b), at(g, a)]);
    });
  });
  vertices.forEach((vertex, v) => {
    const around = polyhedron.faces.flatMap((face, f) => (face.includes(v) ? [at(f, v)] : []));
    const order = sortAround(
      around.map((p) => points[p]!),
      unit(vertex),
    );
    bevels.push(order.map((o) => around[o]!));
  });
  return { points, faces, bevels };
}
