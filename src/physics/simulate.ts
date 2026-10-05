import RAPIER from '@dimforge/rapier3d-compat';
import { cross, length3, rotate, type Pose, type Vec3 } from '../math/quat';
import { FRAME_STRIDE, GRAVITY, STEP_S, WALL_INNER } from './frames';

export const MAX_SIMULATED_S = 6;

const RESTITUTION = 0.35;
const FRICTION = 0.5;
const SETTLE_S = 0.3;
const SETTLE_LINEAR = 0.03;
const SETTLE_ANGULAR = 0.08;
/** Table hits slower than this (units/s at the lowest point) are resting contact, not impacts. */
const MIN_IMPACT_SPEED = 0.15;
const WALL_HALF_THICKNESS = 0.5;
const WALL_HALF_HEIGHT = 20;

export interface TossInput {
  /** Convex hull points in the body's local frame, origin at the center of mass. */
  hull: Float32Array;
  density: number;
  start: Pose;
  linearVelocity: Vec3;
  angularVelocity: Vec3;
  /** Damping keeps a wobbling coin from rocking for many seconds. */
  angularDamping?: number;
  /** Moves the walls inward, keeping a tall body further from the side walls. */
  wallInset?: number;
}

export interface Contact {
  /** Index of the first frame after the impact. */
  frame: number;
  /** Speed of the lowest hull point toward the table just before the impact, units/s. */
  strength: number;
}

export interface Simulation {
  /** FRAME_STRIDE values per frame; frame 0 is the start pose, frame i is at i·STEP_S. */
  frames: Float32Array;
  contacts: Contact[];
  settled: boolean;
}

let ready = false;

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
  ready = true;
}

function addStaticBoxes(world: RAPIER.World, inset: number): RAPIER.Collider {
  const surface = (desc: RAPIER.ColliderDesc) =>
    world.createCollider(desc.setRestitution(RESTITUTION).setFriction(FRICTION));

  const table = surface(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  const x = WALL_INNER.x - inset;
  const z = WALL_INNER.z - inset;
  const t = WALL_HALF_THICKNESS;
  const h = WALL_HALF_HEIGHT;
  surface(RAPIER.ColliderDesc.cuboid(t, h, z + 2 * t).setTranslation(x + t, h, 0));
  surface(RAPIER.ColliderDesc.cuboid(t, h, z + 2 * t).setTranslation(-x - t, h, 0));
  surface(RAPIER.ColliderDesc.cuboid(x + 2 * t, h, t).setTranslation(0, h, z + t));
  surface(RAPIER.ColliderDesc.cuboid(x + 2 * t, h, t).setTranslation(0, h, -z - t));
  return table;
}

function lowestPointApproachSpeed(body: RAPIER.RigidBody, hull: Float32Array): number {
  const q = body.rotation();
  const quat = [q.x, q.y, q.z, q.w] as const;
  let lowest: Vec3 = [0, Infinity, 0];
  for (let i = 0; i < hull.length; i += 3) {
    const r = rotate(quat, [hull[i]!, hull[i + 1]!, hull[i + 2]!]);
    if (r[1] < lowest[1]) lowest = r;
  }
  const v = body.linvel();
  const w = body.angvel();
  const pointVelocityY = v.y + cross([w.x, w.y, w.z], lowest)[1];
  return Math.max(0, -pointVelocityY);
}

export function simulateToss(input: TossInput): Simulation {
  if (!ready) throw new Error('simulateToss called before initPhysics resolved');

  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  const events = new RAPIER.EventQueue(true);
  try {
    world.timestep = STEP_S;
    const table = addStaticBoxes(world, input.wallInset ?? 0);

    const [px, py, pz] = input.start.position;
    const [qx, qy, qz, qw] = input.start.quaternion;
    const [vx, vy, vz] = input.linearVelocity;
    const [wx, wy, wz] = input.angularVelocity;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(px, py, pz)
        .setRotation({ x: qx, y: qy, z: qz, w: qw })
        .setLinvel(vx, vy, vz)
        .setAngvel({ x: wx, y: wy, z: wz })
        .setAngularDamping(input.angularDamping ?? 0)
        .setCcdEnabled(true),
    );
    const hullDesc = RAPIER.ColliderDesc.convexHull(input.hull);
    if (!hullDesc) throw new Error('Degenerate hull');
    world.createCollider(
      hullDesc
        .setDensity(input.density)
        .setRestitution(RESTITUTION)
        .setFriction(FRICTION)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );

    const maxSteps = Math.round(MAX_SIMULATED_S / STEP_S);
    const settleSteps = Math.round(SETTLE_S / STEP_S);
    const frames = new Float32Array((maxSteps + 1) * FRAME_STRIDE);
    const contacts: Contact[] = [];
    const write = (frame: number) => {
      const p = body.translation();
      const q = body.rotation();
      frames.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], frame * FRAME_STRIDE);
    };

    write(0);
    const reach = boundingRadius(input.hull);
    // The launch can strike the table with the low edge of a fast-spinning body; that is the
    // flick, not a landing, so impacts count only after the body has once cleared the table.
    let cleared = false;
    let still = 0;
    let step = 0;
    let settled = false;
    while (step < maxSteps) {
      const approach = lowestPointApproachSpeed(body, input.hull);
      world.step(events);
      step += 1;
      write(step);
      cleared ||= body.translation().y > reach;

      events.drainCollisionEvents((h1, h2, started) => {
        const hitsTable = h1 === table.handle || h2 === table.handle;
        if (started && cleared && hitsTable && approach >= MIN_IMPACT_SPEED) {
          contacts.push({ frame: step, strength: approach });
        }
      });

      const linear = length3(vec(body.linvel()));
      const angular = length3(vec(body.angvel()));
      still = linear < SETTLE_LINEAR && angular < SETTLE_ANGULAR ? still + 1 : 0;
      if (body.isSleeping() || still >= settleSteps) {
        settled = true;
        break;
      }
    }

    return { frames: frames.slice(0, (step + 1) * FRAME_STRIDE), contacts, settled };
  } finally {
    events.free();
    world.free();
  }
}

function boundingRadius(hull: Float32Array): number {
  let max = 0;
  for (let i = 0; i < hull.length; i += 3) {
    max = Math.max(max, Math.hypot(hull[i]!, hull[i + 1]!, hull[i + 2]!));
  }
  return max;
}

function vec(v: { x: number; y: number; z: number }): Vec3 {
  return [v.x, v.y, v.z];
}
