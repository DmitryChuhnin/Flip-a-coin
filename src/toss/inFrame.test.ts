import { PerspectiveCamera, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CIRCUMRADIUS, COIN_BODY, INITIAL_POSE, type CoinValue } from '../coin/coinSpec';
import { multiply, type Pose } from '../math/quat';
import { frameCount, framePose } from '../physics/frames';
import { initPhysics, simulateToss } from '../physics/simulate';
import { computeCameraParams } from '../scene/camera';
import { seededSource } from '../testing/seededSource';
import { planToss, precomputeFallback, type TossPlan } from './planToss';

// Portrait phones only: on square and landscape screens the camera fits the zone tightly and
// the apex of a toss leaves the top of the frame.
const ASPECTS = { 'Pixel 7 portrait': 412 / 915, 'portrait 9:16': 9 / 16 };
/** The walls stand at the screen sides on portrait phones, so a coin touching one may reach them. */
const EDGE_TOLERANCE = 1.01;

let plans: TossPlan<CoinValue>[];

beforeAll(async () => {
  await initPhysics();
  const fallback = precomputeFallback(COIN_BODY, INITIAL_POSE, simulateToss);
  const source = seededSource(99);
  let start: Pose = INITIAL_POSE;
  plans = [];
  for (let i = 0; i < 100; i += 1) {
    const plan = planToss({
      body: COIN_BODY,
      start,
      reducedMotion: i % 4 === 0,
      fallback,
      simulate: simulateToss,
      source,
    });
    plans.push(plan);
    const last = framePose(plan.frames, frameCount(plan.frames) - 1);
    start = { position: last.position, quaternion: multiply(last.quaternion, plan.visualOffset) };
  }
});

describe('toss framing', () => {
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    it(`keeps the whole coin on screen during 100 tosses on ${name}`, () => {
      const params = computeCameraParams(aspect);
      const camera = new PerspectiveCamera(params.fov, aspect, 0.1, 500);
      camera.position.set(...params.position);
      camera.lookAt(...params.lookAt);
      camera.updateMatrixWorld();
      const offsets = [
        [CIRCUMRADIUS, 0, 0],
        [-CIRCUMRADIUS, 0, 0],
        [0, CIRCUMRADIUS, 0],
        [0, -CIRCUMRADIUS, 0],
        [0, 0, CIRCUMRADIUS],
        [0, 0, -CIRCUMRADIUS],
      ];
      let worst = 0;
      for (const plan of plans) {
        for (let i = 0; i < frameCount(plan.frames); i += 1) {
          const [x, y, z] = framePose(plan.frames, i).position;
          for (const [dx, dy, dz] of offsets) {
            const ndc = new Vector3(x + dx!, y + dy!, z + dz!).project(camera);
            worst = Math.max(worst, Math.abs(ndc.x), Math.abs(ndc.y));
          }
        }
      }
      expect(worst).toBeLessThan(EDGE_TOLERANCE);
    });
  }
});
