import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

/** Shadow diameter per unit of body reach, opacity at rest, growth and fade per unit of height. */
export const SHADOW = {
  size: 2.25,
  opacity: 0.55,
  grow: 0.1,
  fade: 0.3,
  minOpacity: 0.15,
} as const;

/** Scale and opacity of the soft spot under a body whose center is `height` above its rest. */
export function shadowLook(height: number): { scale: number; opacity: number } {
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  return {
    scale: 1 + h * SHADOW.grow,
    opacity: Math.max(SHADOW.minOpacity, 0.9 - h * SHADOW.fade) * SHADOW.opacity,
  };
}

export interface ContactShadow {
  mesh: Mesh;
  /** Sizes the spot for a body whose hull reaches `reach` from its center. */
  setReach(reach: number): void;
  /**
   * Moves the spot under the body center at `x, z`, `height` above its rest height. `size` scales
   * it with the body while the body grows in or shrinks away.
   */
  follow(x: number, z: number, height: number, size?: number): void;
}

/**
 * A radial gradient spot that stays under the body; it stands in for a shadow map, which the
 * scene does not render. It is what shows the height of the flight.
 */
export function createContactShadow(): ContactShadow {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available for the contact shadow');
  const r = canvas.width / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.18)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const mesh = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: new CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      // A far camera on a very narrow or wide screen cannot resolve the 0.003 gap by depth alone.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  // Just above the floor, so it does not flicker against it.
  mesh.position.y = 0.003;
  mesh.renderOrder = 1;
  const material = mesh.material as MeshBasicMaterial;
  let diameter = SHADOW.size;

  return {
    mesh,
    setReach(reach) {
      diameter = SHADOW.size * reach;
    },
    follow(x, z, height, size = 1) {
      const { scale, opacity } = shadowLook(height);
      mesh.position.x = x;
      mesh.position.z = z;
      mesh.scale.set(diameter * scale * size, diameter * scale * size, 1);
      material.opacity = opacity * size;
    },
  };
}
