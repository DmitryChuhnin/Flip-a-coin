import { describe, expect, it } from 'vitest';
import { chamfer, convexFaces, faceNormal, sub } from './polyhedron';
import { cross, dot3, length3, type Vec3 } from './quat';

const CUBE: Vec3[] = [-1, 1].flatMap((x) =>
  [-1, 1].flatMap((y) => [-1, 1].map((z): Vec3 => [x, y, z])),
);

describe('convexFaces', () => {
  it('finds the six square faces of a cube, wound counter-clockwise from outside', () => {
    const faces = convexFaces(CUBE);
    expect(faces).toHaveLength(6);
    for (const face of faces) {
      expect(face).toHaveLength(4);
      const corners = face.map((i) => CUBE[i]!);
      const normal = faceNormal(corners);
      expect(dot3(normal, corners[0]!)).toBeCloseTo(1, 9);
      const turn = cross(sub(corners[1]!, corners[0]!), sub(corners[2]!, corners[1]!));
      expect(dot3(turn, normal)).toBeGreaterThan(0);
    }
  });

  it('finds no face for fewer than three points', () => {
    expect(convexFaces(CUBE.slice(0, 2))).toEqual([]);
  });
});

describe('chamfer', () => {
  const cut = chamfer({ vertices: CUBE, faces: convexFaces(CUBE) }, 0.1);

  it('keeps one point per face corner, inside the source shape', () => {
    expect(cut.points).toHaveLength(24);
    for (const p of cut.points) expect(Math.max(...p.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('adds a strip per edge and a corner polygon per vertex', () => {
    expect(cut.bevels.filter((b) => b.length === 4)).toHaveLength(12);
    expect(cut.bevels.filter((b) => b.length === 3)).toHaveLength(8);
  });

  it('builds planar bevels', () => {
    for (const bevel of cut.bevels) {
      const p = bevel.map((i) => cut.points[i]!);
      const normal = cross(sub(p[1]!, p[0]!), sub(p[2]!, p[0]!));
      for (const q of p) {
        expect(Math.abs(dot3(sub(q, p[0]!), normal)) / length3(normal)).toBeLessThan(1e-9);
      }
    }
  });
});
