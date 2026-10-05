import type { Pose, Vec3 } from '../math/quat';
import { GRAVITY } from '../physics/frames';
import type { LandedDamping } from '../physics/simulate';

export type ProfileName = 'normal' | 'edge' | 'spinner' | 'tumble' | 'reduced';

export interface Impulse {
  linearVelocity: Vec3;
  angularVelocity: Vec3;
  angularDamping: number;
  landedDamping?: LandedDamping;
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
  | { perVerticalSpin: readonly [min: number, max: number] }
  /** Spin speed in rad/s about an axis uniform over the sphere; replaces the vertical spin. */
  | { tumble: readonly [min: number, max: number] };

export interface ProfileSpec {
  name: ProfileName;
  weight: number;
  /** Upward launch speed, units/s. */
  lift: readonly [min: number, max: number];
  /** Spin about the vertical axis, rad/s, random sign. */
  verticalSpin: readonly [min: number, max: number];
  flip: Flip;
  /**
   * Horizontal drift along the flip axis (a random horizontal axis when tumbling), units/s,
   * random sign. Rolls a coin landing on edge or a die after its bounces.
   */
  roll: readonly [min: number, max: number];
  angularDamping: number;
  /** Damping from the first landing on, angular and linear; unset keeps angularDamping. */
  landedDamping?: LandedDamping;
}

export interface Launch {
  /** Picked at random by weight for every toss without reduced motion. */
  profiles: readonly ProfileSpec[];
  reduced: ProfileSpec;
  /** Body center height at touchdown: lying on a face, and standing on an edge. */
  touchdown: { flat: number; edge: number };
  /** Straight-up toss recorded once per body; spin rates are tried in order until one rests flat. */
  fallback: FallbackSpec;
  /** The same under reduced motion, no higher than the reduced profile. */
  reducedFallback: FallbackSpec;
  /** A toss not settled within this many seconds is rejected; unset allows MAX_SIMULATED_S. */
  settleWithinS?: number;
}

export interface FallbackSpec {
  /** Upward launch speed, units/s. */
  lift: number;
  /** Half-turns about a horizontal axis during the flight. */
  halfTurns: readonly number[];
}

export const COIN_PROFILES: readonly ProfileSpec[] = [
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
    lift: [7.5, 8.5],
    verticalSpin: [0, 1],
    // Just over half a turn lands rim first and rolls on it; a faster flip tips straight over.
    flip: { halfTurns: [0.55] },
    roll: [0.8, 1.6],
    angularDamping: 0.3,
  },
  {
    name: 'spinner',
    weight: 10,
    // A low toss whose flight lasts 2.5 axis wobbles at this spin, so the rim lands first.
    lift: [8.4, 8.6],
    verticalSpin: [7.2, 7.35],
    flip: { perVerticalSpin: [1.95, 2] },
    roll: [0, 0],
    angularDamping: 0,
  },
];

export const COIN_REDUCED_PROFILE: ProfileSpec = {
  name: 'reduced',
  weight: 1,
  lift: [7.5, 8.5],
  verticalSpin: [0, 0.5],
  flip: { halfTurns: [3, 4] },
  roll: [0, 0],
  angularDamping: 0.3,
};

/** Without it a die balanced on an edge creeps for seconds before it tips. */
const DIE_LANDED_DAMPING: LandedDamping = { angular: 1.5, linear: 1.5 };

export const DIE_PROFILE: ProfileSpec = {
  name: 'tumble',
  weight: 1,
  lift: [7.5, 8.5],
  verticalSpin: [0, 0],
  flip: { tumble: [12, 20] },
  roll: [0.3, 1],
  angularDamping: 0.4,
  landedDamping: DIE_LANDED_DAMPING,
};

export const DIE_REDUCED_PROFILE: ProfileSpec = {
  name: 'reduced',
  weight: 1,
  lift: [6, 7],
  verticalSpin: [0, 0],
  flip: { tumble: [6, 10] },
  roll: [0.2, 0.6],
  angularDamping: 0.4,
  landedDamping: DIE_LANDED_DAMPING,
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

const scaled = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

/** Uniform direction on the unit sphere. */
function sphereAxis(unit: Unit): Vec3 {
  const y = 2 * unit() - 1;
  const a = unit() * 2 * Math.PI;
  const r = Math.sqrt(1 - y * y);
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

export function sampleImpulse(
  profile: ProfileSpec,
  start: Pose,
  unit: Unit,
  touchdown: Launch['touchdown'],
): Impulse {
  const lift = between(profile.lift, unit);
  const startY = start.position[1];
  const halfTurns = 'halfTurns' in profile.flip ? pick(profile.flip.halfTurns, unit) : 0;
  const onEdge = halfTurns % 1 !== 0;
  const flightS = flightTime(lift, startY, onEdge ? touchdown.edge : touchdown.flat);

  const yaw = unit() * 2 * Math.PI;
  const axis: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
  const verticalSpin = between(profile.verticalSpin, unit);
  const flip = profile.flip;
  const tumble = 'tumble' in flip ? scaled(sphereAxis(unit), between(flip.tumble, unit)) : null;
  const flipRate =
    'halfTurns' in flip
      ? ((halfTurns * Math.PI) / flightS) * (1 + (unit() - 0.5) * 0.06)
      : 'perVerticalSpin' in flip
        ? verticalSpin * between(flip.perVerticalSpin, unit)
        : 0;

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
    angularVelocity: tumble ?? [axis[0] * flipRate, verticalSpin * sign(unit), axis[2] * flipRate],
    angularDamping: profile.angularDamping,
    ...(profile.landedDamping && { landedDamping: profile.landedDamping }),
  };
}
