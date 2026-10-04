import { CIRCUMRADIUS, THICKNESS } from '../coin/coinSpec';
import type { Pose, Vec3 } from '../math/quat';
import { GRAVITY } from '../physics/simulate';

export type ProfileName = 'normal' | 'edge' | 'spinner';

export interface Impulse {
  linearVelocity: Vec3;
  angularVelocity: Vec3;
  angularDamping: number;
}

/** Uniform number in [0, 1). */
export type Unit = () => number;

type Flip =
  /** Half-turns about a horizontal axis during the flight; an extra 0.5 lands on the edge. */
  | { halfTurns: readonly number[] }
  /**
   * Flip rate as a multiple of the vertical spin. At 2 (the coin's axial to transverse inertia
   * ratio) the coin axis precesses to horizontal; lift and spin are tuned so that happens at
   * touchdown, and the coin lands on its rim turning about the vertical.
   */
  | { perVerticalSpin: readonly [min: number, max: number] };

interface ProfileSpec {
  name: ProfileName;
  weight: number;
  /** Upward launch speed, units/s. */
  lift: readonly [min: number, max: number];
  /** Spin about the vertical axis, rad/s, random sign. */
  verticalSpin: readonly [min: number, max: number];
  flip: Flip;
  /** Horizontal drift along the flip axis, units/s, random sign. Rolls a coin landing on edge. */
  roll: readonly [min: number, max: number];
  angularDamping: number;
}

export const PROFILES: readonly ProfileSpec[] = [
  {
    name: 'normal',
    weight: 70,
    lift: [10, 11.5],
    verticalSpin: [0, 1.5],
    flip: { halfTurns: [5, 6, 7] },
    roll: [0, 0],
    angularDamping: 0.3,
  },
  {
    name: 'edge',
    weight: 20,
    lift: [8.5, 10],
    verticalSpin: [0, 1],
    // A fast flip carries straight over the rim on touchdown; a slow one leaves the coin on it.
    flip: { halfTurns: [0.5, 1.5] },
    roll: [0.8, 1.6],
    angularDamping: 0.3,
  },
  {
    name: 'spinner',
    weight: 10,
    lift: [10.9, 11.1],
    verticalSpin: [7.3, 7.6],
    flip: { perVerticalSpin: [1.95, 2] },
    roll: [0, 0],
    angularDamping: 0,
  },
];

export const REDUCED_MOTION_PROFILE: ProfileSpec = {
  name: 'normal',
  weight: 1,
  lift: [7.5, 8.5],
  verticalSpin: [0, 0.5],
  flip: { halfTurns: [3, 4] },
  roll: [0, 0],
  angularDamping: 0.3,
};

/** Where tosses aim to land, in table coordinates; the coin drifts back toward it. */
export const LANDING_TARGET = { x: 0, z: 0.3, radius: 0.6 } as const;

const between = ([min, max]: readonly [number, number], unit: Unit) => min + (max - min) * unit();
const sign = (unit: Unit) => (unit() < 0.5 ? -1 : 1);
const pick = <T>(items: readonly T[], unit: Unit): T => items[Math.floor(unit() * items.length)]!;

/** Time until the center falls back to `touchdownY`, starting at `startY`. */
function flightTime(lift: number, startY: number, touchdownY: number): number {
  return (
    (lift + Math.sqrt(Math.max(0, lift * lift - 2 * GRAVITY * (touchdownY - startY)))) / GRAVITY
  );
}

export function sampleImpulse(profile: ProfileSpec, start: Pose, unit: Unit): Impulse {
  const lift = between(profile.lift, unit);
  const startY = start.position[1];
  const halfTurns = 'halfTurns' in profile.flip ? pick(profile.flip.halfTurns, unit) : 0;
  const onEdge = halfTurns % 1 !== 0;
  const flightS = flightTime(lift, startY, onEdge ? CIRCUMRADIUS : THICKNESS / 2);

  const yaw = unit() * 2 * Math.PI;
  const axis: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
  const verticalSpin = between(profile.verticalSpin, unit);
  const flipRate =
    'halfTurns' in profile.flip
      ? ((halfTurns * Math.PI) / flightS) * (1 + (unit() - 0.5) * 0.06)
      : verticalSpin * between(profile.flip.perVerticalSpin, unit);

  const targetAngle = unit() * 2 * Math.PI;
  const targetRadius = Math.sqrt(unit()) * LANDING_TARGET.radius;
  const targetX = LANDING_TARGET.x + Math.cos(targetAngle) * targetRadius;
  const targetZ = LANDING_TARGET.z + Math.sin(targetAngle) * targetRadius;
  const roll = between(profile.roll, unit) * sign(unit);
  const [x, , z] = start.position;

  return {
    linearVelocity: [
      (targetX - x) / flightS + axis[0] * roll,
      lift,
      (targetZ - z) / flightS + axis[2] * roll,
    ],
    angularVelocity: [axis[0] * flipRate, verticalSpin * sign(unit), axis[2] * flipRate],
    angularDamping: profile.angularDamping,
  };
}
