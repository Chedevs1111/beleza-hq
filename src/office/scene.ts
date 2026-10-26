// Renderer, scene, camera and time-of-day lighting. Adapted from ~/law-firm-office/src/world/scene.ts.
// World axes: +x points at the ocean windows (west), +z at the home camera (north), y is up.
import * as THREE from 'three';
import type { Lighting } from './timeofday';

export interface SceneParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  resize(): void;
  /** Moves the picture by (dx, dy) px and scales it, so the office centres in the space the dashboard leaves clear. */
  setFrame(frame: { dx: number; dy: number; zoom: number }): void;
  /** Sun, ambient, exposure, sky and every registered glow for one moment of the day. */
  applyLighting(l: Lighting): void;
  /** Uses an equirectangular HDRI for reflections and for the view through the windows. */
  setEnvironment(hdri: THREE.Texture): void;
}

/** Which `Lighting` level drives a glow: spot lights, LED strips, or the lights on the far shore. */
export type GlowKind = 'interior' | 'led' | 'shore';

interface GlowItem {
  target: THREE.Light | THREE.MeshStandardMaterial;
  kind: GlowKind;
  base: number;
}

interface GlowState {
  items: GlowItem[];
  levels: Record<GlowKind, number>;
}

const glows = new WeakMap<THREE.Scene, GlowState>();

function glowState(scene: THREE.Scene): GlowState {
  let s = glows.get(scene);
  if (!s) {
    s = { items: [], levels: { interior: 1, led: 1, shore: 1 } };
    glows.set(scene, s);
  }
  return s;
}

function setGlow(item: GlowItem, level: number): void {
  const v = item.base * level;
  if (item.target instanceof THREE.Light) item.target.intensity = v;
  else item.target.emissiveIntensity = v;
}

/**
 * Registers a light (its `intensity`) or an emissive material (its `emissiveIntensity`) to follow
 * the `kind` level of the time of day: the value becomes `base * level`. Call once per object.
 */
export function registerGlow(
  scene: THREE.Scene,
  target: THREE.Light | THREE.MeshStandardMaterial,
  kind: GlowKind,
  base: number,
): void {
  const state = glowState(scene);
  const item: GlowItem = { target, kind, base };
  state.items.push(item);
  setGlow(item, state.levels[kind]);
}

// Scene sun light is in lux-like units; timeofday's sunIntensity tops out at ~1.3.
const SUN_SCALE = 3;
const SUN_DISTANCE = 60;
const SUN_TARGET = new THREE.Vector3(0, 2, 0);
// Below the horizon the "sun" is moonlight: keep it grazing from above instead of lighting the floor from beneath.
const MIN_LIGHT_ELEVATION_DEG = 6;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function createScene(canvas: HTMLCanvasElement, opts: { lite: boolean }): SceneParts {
  const { lite } = opts;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in three r186
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xaec4d4); // until the HDRI arrives
  scene.backgroundBlurriness = 0.03;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(-6, 2.6, 10.6);

  const hemi = new THREE.HemisphereLight(0xf2ece2, 0x7a6e60, 0.3);
  const sun = new THREE.DirectionalLight(0xfff3e2, 3);
  sun.target.position.copy(SUN_TARGET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);

  let frame = { dx: 0, dy: 0, zoom: 1 };
  let sizedW = 0;
  let sizedH = 0;
  const resize = () => {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    // setFrame calls this every frame while the picture eases; resizing the drawing buffer is the expensive part,
    // so only do it when the size moved (a new pixel ratio resizes the buffer itself).
    if (w !== sizedW || h !== sizedH) {
      renderer.setSize(w, h, false);
      sizedW = w;
      sizedH = h;
    }
    camera.aspect = w / h;
    camera.zoom = frame.zoom;
    // A view offset the size of the canvas only slides the picture: content moves by (dx, dy), nothing is cropped or zoomed.
    if (frame.dx || frame.dy) camera.setViewOffset(w, h, -frame.dx, -frame.dy, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();
  const setFrame = (f: { dx: number; dy: number; zoom: number }) => {
    frame = { dx: Math.round(f.dx), dy: Math.round(f.dy), zoom: f.zoom };
    resize();
  };

  const setEnvironment = (hdri: THREE.Texture) => {
    hdri.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(hdri).texture;
    pmrem.dispose();
    scene.background = hdri;
  };

  const applyLighting = (l: Lighting) => {
    renderer.toneMappingExposure = l.exposure;

    // Compass bearing (0 = north, 90 = east) to world axes: +z is north and +x is west, so the
    // setting sun lands at +x, shining in through the windows.
    const az = THREE.MathUtils.degToRad(l.sunAzimuthDeg);
    const el = THREE.MathUtils.degToRad(Math.max(l.sunElevationDeg, MIN_LIGHT_ELEVATION_DEG));
    sun.position.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
      .multiplyScalar(SUN_DISTANCE)
      .add(SUN_TARGET);
    sun.color.setHex(l.sunColor);
    sun.intensity = l.sunIntensity * SUN_SCALE;

    const day = smoothstep(-4, 18, l.sunElevationDeg);
    hemi.intensity = lerp(0.1, 0.6, day);
    scene.environmentIntensity = lerp(0.12, 0.8, day);
    scene.backgroundIntensity = lerp(0.03, 1, day);

    const state = glowState(scene);
    state.levels = { interior: l.interiorLights, led: l.ledGlow, shore: l.shoreLights };
    for (const item of state.items) setGlow(item, state.levels[item.kind]);
  };

  return { renderer, scene, camera, sun, hemi, resize, setFrame, applyLighting, setEnvironment };
}
