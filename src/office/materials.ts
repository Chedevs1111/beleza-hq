// Physically based materials for the office shell. `materialSpec` is pure data; `createMaterials` wraps it in three.js.
import * as THREE from 'three';
import type { TextureKey, TextureSet } from './assets';

export type MaterialKey = TextureKey | 'metal' | 'led' | 'glass';

export interface MaterialSpec {
  /** Flat colour, used when no texture is loaded. */
  color: number;
  /** Scalar roughness; multiplied by the roughness map when there is one. */
  roughness: number;
  metalness: number;
  emissive?: number;
  transmission?: number;
}

const SPECS: Record<MaterialKey, MaterialSpec> = {
  concrete: { color: 0x8a8a87, roughness: 1, metalness: 0 }, // raw, matte
  oak: { color: 0xb98c5a, roughness: 0.75, metalness: 0 },
  terrazzo: { color: 0x9a948c, roughness: 0.9, metalness: 0 }, // map is mostly low roughness: honed, not glossy
  stone: { color: 0xe4dfd6, roughness: 0.95, metalness: 0 },
  floor: { color: 0x74746f, roughness: 0.35, metalness: 0 }, // polished concrete
  metal: { color: 0xc9ccd1, roughness: 0.35, metalness: 0.9 }, // silver ducts
  led: { color: 0xffc27a, roughness: 0.5, metalness: 0, emissive: 0xffa24a }, // warm amber strip
  glass: { color: 0xffffff, roughness: 0.04, metalness: 0, transmission: 0.95 },
};

export function materialSpec(key: MaterialKey): MaterialSpec {
  return { ...SPECS[key] };
}

// Textured materials multiply the map by this; white leaves the map alone.
const TINT: Partial<Record<TextureKey, number>> = { concrete: 0xeceff2, floor: 0xfff2e2 }; // concrete map is brown-dark: neutralise it; warm the floor against the cool sky
// Linear brightness lift on top of the tint (the reference's concrete is much lighter than the map).
const GAIN: Partial<Record<TextureKey, number>> = { concrete: 1.8, floor: 1.35 };

export interface Materials {
  concrete: THREE.MeshStandardMaterial;
  oak: THREE.MeshStandardMaterial;
  terrazzo: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  /** Emissive amber; `buildShell` registers it as the `led` glow. */
  led: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  /** Matte black for mullions, track rails and spot housings. */
  black: THREE.MeshStandardMaterial;
}

function standard(key: MaterialKey, set?: TextureSet): THREE.MeshStandardMaterial {
  const spec = materialSpec(key);
  const m = new THREE.MeshStandardMaterial({
    color: set ? (TINT[key as TextureKey] ?? 0xffffff) : spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
  });
  if (set) {
    m.map = set.baseColor;
    m.normalMap = set.normal;
    m.roughnessMap = set.roughness;
    m.color.multiplyScalar(GAIN[key as TextureKey] ?? 1);
  }
  if (spec.emissive !== undefined) m.emissive.setHex(spec.emissive);
  return m;
}

/**
 * Builds the shared materials. Missing texture sets fall back to flat colours.
 * `lite` swaps the glass's transmission pass (a whole extra render of the scene) for plain transparency.
 */
export function createMaterials(
  sets: Partial<Record<TextureKey, TextureSet>>,
  opts: { lite: boolean },
): Materials {
  const g = materialSpec('glass');
  const glass = new THREE.MeshPhysicalMaterial({
    color: g.color,
    roughness: g.roughness,
    metalness: g.metalness,
    ior: 1.45,
    thickness: 0.05,
  });
  if (opts.lite) {
    glass.transparent = true;
    glass.opacity = 0.12;
  } else {
    glass.transmission = g.transmission ?? 1;
  }

  return {
    concrete: standard('concrete', sets.concrete),
    oak: standard('oak', sets.oak),
    terrazzo: standard('terrazzo', sets.terrazzo),
    stone: standard('stone', sets.stone),
    floor: standard('floor', sets.floor),
    metal: standard('metal'),
    led: standard('led'),
    glass,
    black: new THREE.MeshStandardMaterial({ color: 0x0f0f11, roughness: 0.45, metalness: 0.15 }),
  };
}
