import { PerspectiveCamera, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { COIN_BODY } from '../coin/coinSpec';
import { createDie, DIE_KINDS } from '../dice/dieSpec';
import { multiply, rotate, type Pose } from '../math/quat';
import { frameCount, framePose, STEP_S } from '../physics/frames';
import { initPhysics, simulateToss } from '../physics/simulate';
import { computeCameraParams } from '../scene/camera';
import { seededSource } from '../testing/seededSource';
import { hullVectors, type TossBody } from './body';
import { planToss, precomputeFallback, type TossPlan } from './planToss';
import { visualPose } from './playback';

// Portrait phones only: on square and landscape screens the camera fits the zone tightly and
// the apex of a toss leaves the top of the frame.
const ASPECTS = { 'Pixel 7 portrait': 412 / 915, 'portrait 9:16': 9 / 16 };
/** The walls stand at the screen sides on portrait phones, so a coin touching one may reach them. */
const EDGE_TOLERANCE = 1.01;

const BODIES: Record<string, TossBody<string>> = {
  coin: COIN_BODY,
  ...Object.fromEntries(DIE_KINDS.map((kind) => [kind, createDie(kind).body])),
};
const plans: Record<string, TossPlan<string>[]> = {};

beforeAll(async () => {
  await initPhysics();
  for (const [name, body] of Object.entries(BODIES)) {
    const fallback = precomputeFallback(body, simulateToss);
    const source = seededSource(99);
    let start: Pose = body.initialPose;
    plans[name] = [];
    for (let i = 0; i < 100; i += 1) {
      const plan = planToss({
        body,
        start,
        reducedMotion: i % 4 === 0,
        fallback,
        simulate: simulateToss,
        source,
      });
      plans[name].push(plan);
      const last = framePose(plan.frames, frameCount(plan.frames) - 1);
      start = { position: last.position, quaternion: multiply(last.quaternion, plan.visualOffset) };
    }
  }
});

describe('toss framing', () => {
  for (const [name, body] of Object.entries(BODIES)) {
    for (const [screen, aspect] of Object.entries(ASPECTS)) {
      it(`keeps the whole ${name} on screen during 100 tosses on ${screen}`, () => {
        const params = computeCameraParams(aspect);
        const camera = new PerspectiveCamera(params.fov, aspect, 0.1, 500);
        camera.position.set(...params.position);
        camera.lookAt(...params.lookAt);
        camera.updateMatrixWorld();
        const hull = hullVectors(body.hull);
        let worst = 0;
        for (const plan of plans[name]!) {
          for (let i = 0; i < frameCount(plan.frames); i += 1) {
            // The drawn pose, which differs from the body pose while the remap eases in.
            const pose = visualPose(plan, i * STEP_S);
            for (const p of hull) {
              const r = rotate(pose.quaternion, p);
              const ndc = new Vector3(
                pose.position[0] + r[0],
                pose.position[1] + r[1],
                pose.position[2] + r[2],
              ).project(camera);
              worst = Math.max(worst, Math.abs(ndc.x), Math.abs(ndc.y));
            }
          }
        }
        expect(worst).toBeLessThan(EDGE_TOLERANCE);
      });
    }
  }
});
