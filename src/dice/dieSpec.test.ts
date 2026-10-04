import { describe, expect, it } from 'vitest';
import { sub } from '../math/polyhedron';
import {
  cross,
  dot3,
  fromAxisAngle,
  fromTo,
  length3,
  multiply,
  rotate,
  type Vec3,
} from '../math/quat';
import { hullVectors } from '../toss/body';
import { remapRotation, upFace } from '../toss/faces';
import { atlasLayout, createDieGeometry, faceUv } from './dieMesh';
import { createDie, DIE_KINDS, type DieKind } from './dieSpec';

const GROUP_ORDER: Record<DieKind, number> = { d4: 12, d6: 24, d8: 24, d10: 10, d12: 60, d20: 60 };
const SIDES: Record<DieKind, number> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

const dice = Object.fromEntries(DIE_KINDS.map((kind) => [kind, createDie(kind)]));

/** Rest pose with face `index` up, turned by `yaw` about the vertical. */
function upPose(kind: DieKind, index: number, yaw: number) {
  const normal = dice[kind]!.body.faces[index]!.normal;
  return multiply(fromAxisAngle([0, 1, 0], yaw), fromTo(normal, [0, 1, 0]));
}

describe.each(DIE_KINDS)('%s', (kind) => {
  const die = dice[kind]!;
  const { body } = die;
  const n = SIDES[kind];

  it(`has ${n} outcomes valued 1 to ${n} once each`, () => {
    expect(body.faces).toHaveLength(n);
    const values = body.faces.map((f) => Number(f.value)).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  });

  it(`has a rotation group of order ${GROUP_ORDER[kind]} that maps the cut hull onto itself`, () => {
    expect(body.symmetries).toHaveLength(GROUP_ORDER[kind]);
    const points = hullVectors(body.hull);
    for (const q of body.symmetries) {
      for (const p of points) {
        const r = rotate(q, p);
        expect(Math.min(...points.map((s) => length3(sub(r, s))))).toBeLessThan(1e-5);
      }
    }
  });

  it('remaps every landed face to every desired face with the desired one exactly up', () => {
    for (let landed = 0; landed < n; landed += 1) {
      const pose = upPose(kind, landed, 0.37 * landed);
      expect(upFace(pose, body.faces)).toEqual({ index: landed, tiltDeg: expect.any(Number) });
      for (let desired = 0; desired < n; desired += 1) {
        const r = remapRotation(body.remaps, landed, desired, [0.2, 0.9, -0.4]);
        const shown = upFace(multiply(pose, r), body.faces);
        expect(shown.index).toBe(desired);
        expect(shown.tiltDeg).toBeLessThan(1e-4);
      }
    }
  });

  it('starts resting flat on the table with the highest value up', () => {
    const { position, quaternion } = body.initialPose;
    const up = upFace(quaternion, body.faces);
    expect(body.faces[up.index]!.value).toBe(String(n));
    expect(up.tiltDeg).toBeLessThan(1e-4);
    const lowest = Math.min(...hullVectors(body.hull).map((p) => rotate(quaternion, p)[1]));
    expect(position[1] + lowest).toBeCloseTo(0, 6);
  });

  it('draws a mesh that is exactly the collider hull, wound outward', () => {
    const geometry = createDieGeometry(die);
    const position = geometry.getAttribute('position');
    const hull = hullVectors(body.hull);
    const vertex = (i: number): Vec3 => [position.getX(i), position.getY(i), position.getZ(i)];
    for (let i = 0; i < position.count; i += 3) {
      const [a, b, c] = [vertex(i), vertex(i + 1), vertex(i + 2)];
      const normal = cross(sub(b, a), sub(c, a));
      const unitNormal: Vec3 = [
        normal[0] / length3(normal),
        normal[1] / length3(normal),
        normal[2] / length3(normal),
      ];
      expect(dot3(unitNormal, a)).toBeGreaterThan(0);
      // Every collider point is on or behind the triangle's plane: the mesh is the convex hull.
      for (const p of hull) expect(dot3(unitNormal, sub(p, a))).toBeLessThan(1e-5);
    }
    expect(geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
  });

  it('maps every numbered face into its own atlas cell and keeps labels on the face', () => {
    const layout = atlasLayout(die.art.length);
    die.shape.faces.forEach((face, f) => {
      const column = f % layout.columns;
      const row = Math.floor(f / layout.columns);
      for (const i of face) {
        const [u, v] = faceUv(die.art[f]!, f, layout, die.shape.points[i]!);
        expect(u).toBeGreaterThanOrEqual(column / layout.columns - 1e-9);
        expect(u).toBeLessThanOrEqual((column + 1) / layout.columns + 1e-9);
        expect(v).toBeGreaterThanOrEqual(1 - (row + 1) / layout.rows - 1e-9);
        expect(v).toBeLessThanOrEqual(1 - row / layout.rows + 1e-9);
      }
      for (const label of die.art[f]!.labels) {
        expect(Math.hypot(label.x, label.y) + label.height / 2).toBeLessThan(die.art[f]!.half);
        expect(Math.hypot(...label.up)).toBeCloseTo(1, 9);
        expect(label.height).toBeGreaterThan(0);
      }
    });
  });

  it('underlines 6 and 9 and nothing else', () => {
    for (const label of die.art.flatMap((a) => a.labels)) {
      expect(label.underline).toBe(label.text === '6' || label.text === '9');
    }
  });
});

describe.each(['d6', 'd8', 'd10', 'd12', 'd20'] as const)('%s numbering', (kind) => {
  it('puts values summing to sides + 1 on opposite faces', () => {
    const { faces } = dice[kind]!.body;
    for (const face of faces) {
      const opposite = faces.find((f) => dot3(f.normal, face.normal) < -1 + 1e-9)!;
      expect(Number(face.value) + Number(opposite.value)).toBe(SIDES[kind] + 1);
    }
  });

  it('prints one label per face, the face value', () => {
    const die = dice[kind]!;
    const values = die.art.map((a) => a.labels.map((l) => l.text));
    expect(values.every((labels) => labels.length === 1)).toBe(true);
    expect(values.flat().sort()).toEqual(die.body.faces.map((f) => f.value).sort());
  });
});

describe('d10', () => {
  it('prints 10 rather than 0 and keeps odd values on one hemisphere', () => {
    const { faces } = dice.d10!.body;
    expect(faces.map((f) => f.value)).toContain('10');
    expect(faces.map((f) => f.value)).not.toContain('0');
    for (const face of faces) expect(face.normal[1] > 0).toBe(Number(face.value) % 2 === 1);
  });
});

describe('d4', () => {
  const die = dice.d4!;
  const { body } = die;

  it('reads the top vertex with zero tilt when resting flat on any face', () => {
    // Resting on a face means the opposite vertex points straight up.
    for (let face = 0; face < 4; face += 1) {
      for (const yaw of [0, 1, 2.5]) {
        const up = upFace(upPose('d4', face, yaw), body.faces);
        expect(up.index).toBe(face);
        expect(up.tiltDeg).toBeLessThan(1e-4);
      }
    }
  });

  it('rests on the face opposite the top vertex', () => {
    for (let face = 0; face < 4; face += 1) {
      const pose = upPose('d4', face, 0);
      const lowest = Math.min(...hullVectors(body.hull).map((p) => rotate(pose, p)[1]));
      const bottom = hullVectors(body.hull).filter(
        (p) => Math.abs(rotate(pose, p)[1] - lowest) < 1e-5,
      );
      // The cut bottom face has three corners on the table.
      expect(bottom).toHaveLength(3);
    }
  });

  it('prints on each face the three values of its corners, near those corners', () => {
    const top = (index: number) => body.faces[index]!;
    for (const art of die.art) {
      const texts = art.labels.map((l) => l.text).sort();
      expect(texts).toHaveLength(3);
      // The vertex the face does not touch is the one opposite it.
      const facing: Vec3 = cross(art.u, art.v);
      const missing = body.faces.find((v) => dot3(v.normal, facing) < -0.99)!;
      expect(texts).not.toContain(missing.value);
      for (const label of art.labels) {
        const vertex = top(body.faces.findIndex((v) => v.value === label.text)).normal;
        const up3: Vec3 = [
          art.u[0] * label.up[0] + art.v[0] * label.up[1],
          art.u[1] * label.up[0] + art.v[1] * label.up[1],
          art.u[2] * label.up[0] + art.v[2] * label.up[1],
        ];
        // Text points toward its own vertex, so it reads upright when that vertex is on top.
        expect(dot3(up3, vertex)).toBeGreaterThan(0.5);
      }
    }
  });
});
