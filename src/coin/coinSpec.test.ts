import { describe, expect, it } from 'vitest';
import { rotate } from '../math/quat';
import { CIRCUMRADIUS, COIN_BODY, COIN_SYMMETRIES, hullPoints, THICKNESS } from './coinSpec';

function points(): [number, number, number][] {
  const hull = hullPoints();
  return Array.from({ length: hull.length / 3 }, (_, i) => [
    hull[3 * i]!,
    hull[3 * i + 1]!,
    hull[3 * i + 2]!,
  ]);
}

describe('coin spec', () => {
  it('maps the hull onto itself under every listed symmetry', () => {
    const hull = points();
    for (const symmetry of COIN_SYMMETRIES) {
      for (const p of hull) {
        const q = rotate(symmetry, p);
        const nearest = Math.min(
          ...hull.map((h) => Math.hypot(h[0] - q[0], h[1] - q[1], h[2] - q[2])),
        );
        expect(nearest).toBeLessThan(1e-6);
      }
    }
  });

  it('lists 16 distinct symmetries starting with identity and the half-turn about X', () => {
    expect(COIN_SYMMETRIES).toHaveLength(16);
    expect(COIN_SYMMETRIES[0]).toEqual([0, 0, 0, 1]);
    expect(COIN_SYMMETRIES[1]![0]).toBeCloseTo(1, 9);
  });

  it('keeps the hull within the coin size and the clearance above every hull point', () => {
    for (const [x, y, z] of points()) {
      expect(Math.abs(y)).toBeLessThanOrEqual(THICKNESS / 2 + 1e-6);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(CIRCUMRADIUS + 1e-6);
      expect(Math.hypot(x, y, z)).toBeLessThan(COIN_BODY.clearance);
    }
  });
});
