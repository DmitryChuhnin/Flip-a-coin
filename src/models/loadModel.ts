import { Group, Vector3, type BufferGeometry, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Vec3 } from '../math/quat';
import type { TossBody } from '../toss/body';
import { modelBody } from './modelBody';

export interface ModelItem<V extends string> {
  /** The `visual` node in game units, drawn in place of the procedural mesh. */
  visual: Object3D;
  body: TossBody<V>;
}

/**
 * Item from a `.glb` in the format of README.md, "Models". A model that breaks the format throws
 * a RangeError; a file that does not parse, an Error with the loader's error as its cause.
 */
export async function loadModel<V extends string>(
  data: ArrayBuffer,
  template: TossBody<V>,
): Promise<ModelItem<V>> {
  let scene: Object3D;
  try {
    ({ scene } = await new GLTFLoader().parseAsync(data, ''));
  } catch (error) {
    // The loader throws RangeErrors of its own on a truncated file.
    throw new Error('The file is not a readable glTF model', { cause: error });
  }
  scene.updateMatrixWorld(true);
  const visual = scene.getObjectByName('visual');
  if (!visual) throw new RangeError('The model has no node named visual');
  const collider = scene.getObjectByName('collider');
  const faces = [scene, collider, visual]
    .map((node) => node?.userData.faces as unknown)
    .find((value) => value !== undefined);
  const { body, scale } = modelBody({ points: meshPoints(collider ?? visual), faces }, template);

  visual.matrixWorld.decompose(visual.position, visual.quaternion, visual.scale);
  visual.removeFromParent();
  collider?.removeFromParent();
  const root = new Group();
  root.scale.setScalar(scale);
  root.add(visual);
  return { visual: root, body };
}

/** Points of every mesh under `node`, in the scene's frame. */
function meshPoints(node: Object3D): Vec3[] {
  const points: Vec3[] = [];
  const point = new Vector3();
  node.traverse((object) => {
    const position = (object as { geometry?: BufferGeometry }).geometry?.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      points.push([point.x, point.y, point.z]);
    }
  });
  return points;
}
