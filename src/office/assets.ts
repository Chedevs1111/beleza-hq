// Asset manifest, PBR texture sets, HDRI and the shared glTF loader.
// Manifest paths are relative to `public/`; textures are WebP/JPG and GLBs are meshopt-compressed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export type TextureKey = 'concrete' | 'oak' | 'terrazzo' | 'stone' | 'floor';

export interface Manifest {
  people: Record<string, { file: string; clips: string[]; triangles: number }>;
  textures: Record<TextureKey, { baseColor: string; normal: string; roughness: string }>;
  hdri: string;
  sources: { name: string; url: string; licence: string }[];
}

export interface TextureSet {
  baseColor: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
}

/** URL of a file under `public/`, e.g. `assetUrl('assets/people/x.glb')`. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

let manifestPromise: Promise<Manifest> | undefined;

export function loadManifest(): Promise<Manifest> {
  manifestPromise ??= fetch(assetUrl('assets/manifest.json')).then((res) => {
    if (!res.ok) throw new Error(`Asset manifest failed to load (${res.status})`);
    return res.json() as Promise<Manifest>;
  });
  manifestPromise.catch(() => { manifestPromise = undefined; }); // let a later call retry
  return manifestPromise;
}

const textureLoader = new THREE.TextureLoader();
const ANISOTROPY = 8; // three clamps this to what the GPU supports

function loadTexture(path: string, srgb: boolean): Promise<THREE.Texture> {
  return textureLoader.loadAsync(assetUrl(path)).then((tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = ANISOTROPY;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace; // base colour only; normal and roughness stay linear
    return tex;
  });
}

export async function loadTextureSet(key: TextureKey): Promise<TextureSet> {
  const paths = (await loadManifest()).textures[key];
  if (!paths) throw new Error(`No texture set "${key}" in the manifest`);
  const [baseColor, normal, roughness] = await Promise.all([
    loadTexture(paths.baseColor, true),
    loadTexture(paths.normal, false),
    loadTexture(paths.roughness, false),
  ]);
  return { baseColor, normal, roughness };
}

/** The equirectangular HDRI named in the manifest. */
export async function loadHdri(): Promise<THREE.DataTexture> {
  const { hdri } = await loadManifest();
  return new HDRLoader().loadAsync(assetUrl(hdri));
}

/** One glTF loader for every GLB: the people use EXT_meshopt_compression and KHR_mesh_quantization. */
export function createGltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}
