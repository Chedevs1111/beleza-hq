// Small geometry helpers shared by the loft, furniture and ocean builders.
import * as THREE from 'three';
import type { Materials } from './materials';

/** A box whose UVs are scaled to world metres, so a texture keeps its real-world size on every face. */
export function box(w: number, h: number, d: number, tile: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // Face order is +x, -x, +y, -y, +z, -z with four vertices each: [u extent, v extent].
  const extents: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = f * 4; i < f * 4 + 4; i++) {
      uv.setXY(i, (uv.getX(i) * extents[f][0]) / tile, (uv.getY(i) * extents[f][1]) / tile);
    }
  }
  return g;
}

export function mesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadows = true,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

/** One draw call for many copies of a geometry. Each placement is `[x, y, z, yaw?, sx?, sy?, sz?]`. */
export type Placement = [number, number, number, number?, number?, number?, number?];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  placements: Placement[],
  shadows = true,
): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, placements.length);
  placements.forEach(([x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1], i) => {
    _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, yaw), _s.set(sx, sy, sz));
    im.setMatrixAt(i, _m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = shadows;
  im.receiveShadow = true;
  return im;
}

export interface Finishes {
  /** Honey-coloured oak: the shared oak map is pale and pink next to the reference. */
  oak: THREE.MeshStandardMaterial;
  /** Cool grey terrazzo: the shared map is speckled brown. */
  terrazzo: THREE.MeshStandardMaterial;
}

const finishCache = new WeakMap<Materials, Finishes>();

/** Re-tinted copies of the shared oak and terrazzo (same maps, different colour), made once per set of materials. */
export function finishes(mats: Materials): Finishes {
  let f = finishCache.get(mats);
  if (!f) {
    const oak = mats.oak.clone();
    oak.color.set(0xf3d19a).multiplyScalar(1.05);
    const terrazzo = mats.terrazzo.clone();
    terrazzo.color.set(0x9fb2c8).multiplyScalar(1.7);
    f = { oak, terrazzo };
    finishCache.set(mats, f);
  }
  return f;
}
