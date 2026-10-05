import { PerspectiveCamera, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { COIN_BODY } from '../coin/coinSpec';
import { createDie, DIE_KINDS } from '../dice/dieSpec';
import { multiply, rotate, type Pose } from '../math/quat';
import { frameCount, framePose, GRAVITY, STEP_S } from '../physics/frames';
import { initPhysics, simulateToss } from '../physics/simulate';
import { computeCameraParams, FLIGHT_CEILING, type CameraParams, type Vec3 } from '../scene/camera';
import {
  cameraAt,
  closeUpView,
  flightCorners,
  flightView,
  LAUNCH_SHOT_S,
  SETTLE_SHOT_S,
  type Shot,
} from '../scene/shots';
import { seededSource } from '../testing/seededSource';
import { bodyReach, hullVectors, type TossBody } from './body';
import { planToss, precomputeFallback, type TossPlan } from './planToss';
import { visualPose } from './playback';

const ASPECTS = {
  'narrow 1:10': 1 / 10,
  'Pixel 7 portrait': 412 / 915,
  'portrait 9:16': 9 / 16,
  'square 1:1': 1,
  'landscape 16:9': 16 / 9,
  'wide 10:1': 10,
};

const BODIES: Record<string, TossBody<string>> = {
  coin: COIN_BODY,
  ...Object.fromEntries(DIE_KINDS.map((kind) => [kind, createDie(kind).body])),
};
const plans: Record<string, { start: Pose; plan: TossPlan<string>; reducedMotion: boolean }[]> = {};

/** Largest |NDC| of the body's hull at `pose` seen with `params`; below 1 is fully on screen. */
function worstNdc(params: CameraParams, aspect: number, hull: readonly Vec3[], pose: Pose): number {
  const camera = new PerspectiveCamera(params.fov, aspect, 0.1, 500);
  camera.position.set(...params.position);
  camera.lookAt(...params.lookAt);
  camera.updateMatrixWorld();
  let worst = 0;
  for (const p of hull) {
    const r = rotate(pose.quaternion, p);
    const ndc = new Vector3(
      pose.position[0] + r[0],
      pose.position[1] + r[1],
      pose.position[2] + r[2],
    ).project(camera);
    worst = Math.max(worst, Math.abs(ndc.x), Math.abs(ndc.y));
  }
  return worst;
}

beforeAll(async () => {
  await initPhysics();
  for (const [name, body] of Object.entries(BODIES)) {
    const fallback = precomputeFallback(body, simulateToss);
    const source = seededSource(99);
    let start: Pose = body.initialPose;
    plans[name] = [];
    for (let i = 0; i < 100; i += 1) {
      const reducedMotion = i % 4 === 0;
      const plan = planToss({
        body,
        start,
        reducedMotion,
        fallback,
        simulate: simulateToss,
        source,
      });
      plans[name].push({ start, plan, reducedMotion });
      const last = framePose(plan.frames, frameCount(plan.frames) - 1);
      start = { position: last.position, quaternion: multiply(last.quaternion, plan.visualOffset) };
    }
  }
});

describe('toss framing', () => {
  for (const [name, body] of Object.entries(BODIES)) {
    it(`keeps the ${name} under the flight ceiling at the highest launch`, () => {
      const { profiles, reduced, fallback, touchdown } = body.launch;
      const lift = Math.max(fallback.lift, ...[...profiles, reduced].map((p) => p.lift[1]));
      const reach = bodyReach(body.hull);
      expect(touchdown.flat + (lift * lift) / (2 * GRAVITY) + reach).toBeLessThan(FLIGHT_CEILING);
    });
  }

  for (const [name, body] of Object.entries(BODIES)) {
    for (const [screen, aspect] of Object.entries(ASPECTS)) {
      it(`keeps the whole ${name} in the wide view during 100 tosses on ${screen}`, () => {
        // The camera under reduced motion; it frames any toss from anywhere on the table.
        const params = computeCameraParams(aspect);
        const hull = hullVectors(body.hull);
        let worst = 0;
        for (const { plan } of plans[name]!) {
          for (let i = 0; i < frameCount(plan.frames); i += 1) {
            // The drawn pose, which differs from the body pose while the remap eases in.
            worst = Math.max(worst, worstNdc(params, aspect, hull, visualPose(plan, i * STEP_S)));
          }
        }
        expect(worst).toBeLessThan(1);
      });

      it(`keeps the whole ${name} in the moving camera during 100 tosses on ${screen}`, () => {
        const hull = hullVectors(body.hull);
        const reach = bodyReach(body.hull);
        let worst = 0;
        for (const { start, plan, reducedMotion } of plans[name]!) {
          if (reducedMotion) continue;
          const launch: Shot = {
            from: closeUpView(start.position, reach),
            to: flightView(flightCorners(plan, hull)),
            startS: 0,
            durationS: LAUNCH_SHOT_S,
          };
          for (let i = 0; i < frameCount(plan.frames); i += 1) {
            const t = i * STEP_S;
            const params = cameraAt(launch, t, aspect, false);
            worst = Math.max(worst, worstNdc(params, aspect, hull, visualPose(plan, t)));
          }
          const rest = visualPose(plan, plan.durationS);
          const settle: Shot = {
            from: launch.to,
            to: closeUpView(rest.position, reach),
            startS: 0,
            durationS: SETTLE_SHOT_S,
          };
          for (let t = 0; t <= SETTLE_SHOT_S; t += STEP_S) {
            worst = Math.max(
              worst,
              worstNdc(cameraAt(settle, t, aspect, false), aspect, hull, rest),
            );
          }
        }
        expect(worst).toBeLessThan(1);
      });
    }
  }
});
