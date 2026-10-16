import type { Vec3 } from '../math/quat';

export interface GlbNode {
  name: string;
  /** Mesh points as triangles of consecutive points; the last one repeats to fill a triangle. */
  points?: readonly Vec3[];
  extras?: Record<string, unknown>;
  scale?: Vec3;
  children?: readonly GlbNode[];
}

const GLTF_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const FLOAT = 5126;
const TRIANGLES = 4;

/** Binary glTF with one scene of the given nodes, no materials or textures. */
export function buildGlb(
  nodes: readonly GlbNode[],
  sceneExtras?: Record<string, unknown>,
): ArrayBuffer {
  const gltfNodes: object[] = [];
  const meshes: object[] = [];
  const accessors: object[] = [];
  const bufferViews: object[] = [];
  const data: number[] = [];

  const add = (node: GlbNode): number => {
    const entry: Record<string, unknown> = {
      name: node.name,
      extras: node.extras,
      scale: node.scale,
    };
    const index = gltfNodes.push(entry) - 1;
    if (node.points) {
      const points = [...node.points];
      while (points.length % 3 !== 0) points.push(points[points.length - 1]!);
      bufferViews.push({ buffer: 0, byteOffset: data.length * 4, byteLength: points.length * 12 });
      accessors.push({
        bufferView: bufferViews.length - 1,
        componentType: FLOAT,
        count: points.length,
        type: 'VEC3',
        min: [0, 1, 2].map((axis) => Math.min(...points.map((p) => Math.fround(p[axis]!)))),
        max: [0, 1, 2].map((axis) => Math.max(...points.map((p) => Math.fround(p[axis]!)))),
      });
      data.push(...points.flat());
      meshes.push({
        primitives: [{ attributes: { POSITION: accessors.length - 1 }, mode: TRIANGLES }],
      });
      entry.mesh = meshes.length - 1;
    }
    if (node.children) entry.children = node.children.map(add);
    return index;
  };
  const roots = nodes.map(add);

  const bin = new Uint8Array(new Float32Array(data).buffer);
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: roots, extras: sceneExtras }],
      nodes: gltfNodes,
      meshes,
      accessors,
      bufferViews,
      buffers: [{ byteLength: bin.byteLength }],
    }),
  );
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const binLength = Math.ceil(bin.byteLength / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLTF_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(json, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, BIN_CHUNK, true);
  out.set(bin, 28 + jsonLength);
  return out.buffer;
}
