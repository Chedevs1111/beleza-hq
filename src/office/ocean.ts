// The view through the glazing: sky, a terrace and sea wall, moving water, and a far shore whose lights come on at dusk.
// +x is the ocean. Everything outside the office is built here; the sun and light levels come from `Lighting`.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { OFFICE } from './layout';
import type { Lighting } from './timeofday';

const WATER_Y = -3.2; // the office sits on a pier a few metres above the sea
const PIER_END = OFFICE.windowsX + 4.5; // pier's seaward edge in x: a 4.5 m terrace outside the glass
const SHORE_X = 215; // far coast, metres from the origin
const SHORE_SPAN = 450; // how far the coast runs either side of the office, in z
const SHORE_LIGHT_BASE = 1.5; // emissive intensity of the far-shore windows at full shore level

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Small deterministic random source, so the coast is the same on every load. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiling water normal map, made from a handful of sine waves so nothing has to be downloaded. */
function makeWaterNormals(): THREE.DataTexture {
  const N = 256;
  // [cycles across the tile in u, in v, steepest slope that wave adds]: integer cycles keep the tile seamless.
  const waves: [number, number, number][] = [
    [3, 1, 0.1], [2, -4, 0.09], [7, 5, 0.08], [-9, 6, 0.07], [13, -11, 0.05], [21, 17, 0.035], [-27, 9, 0.03],
  ];
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let dx = 0;
      let dy = 0;
      waves.forEach(([fx, fy, slope], k) => {
        const phase = 2 * Math.PI * ((fx * x) / N + (fy * y) / N) + k * 1.7;
        const c = (Math.cos(phase) * slope) / Math.hypot(fx, fy);
        dx += c * fx;
        dy += c * fy;
      });
      const len = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Dark facade with scattered warm windows, used as the emissive map of the far-shore buildings. */
function makeWindowMap(): THREE.DataTexture {
  const rand = rng(5);
  const W = 32;
  const H = 32;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lit = x % 3 !== 2 && y % 3 !== 2 && rand() < 0.45; // a window grid with some rooms dark
      const v = lit ? 150 + rand() * 105 : 0;
      const i = (y * W + x) * 4;
      data[i] = v;
      data[i + 1] = v * (0.8 + rand() * 0.12);
      data[i + 2] = v * (0.45 + rand() * 0.25);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Where the far shoreline runs at depth z. */
const shoreX = (z: number) => SHORE_X + 22 * Math.sin(z / 70) + 9 * Math.sin(z / 23 + 1);

/** Ground height of the far coast: a beach, then low hills rising inland. `u` is metres inland from the water's edge. */
function coastHeight(u: number, z: number): number {
  const beach = 1.4 * smoothstep(-6, 4, u);
  const hills = 0.16 * Math.max(0, u - 12) * (0.7 + 0.3 * Math.sin(z / 37 + u / 55));
  const ridge = 6 * smoothstep(60, 230, u) * (0.5 + 0.5 * Math.sin(z / 90 + 1));
  return WATER_Y - 0.8 + beach + hills + ridge;
}

function buildCoast(lite: boolean): THREE.Mesh {
  const NX = lite ? 24 : 46;
  const NZ = lite ? 90 : 180;
  const DEPTH = 230;
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const sand = new THREE.Color(0xd8c79a);
  const green = new THREE.Color(0x6b7f4a);
  const dry = new THREE.Color(0x867b57);
  const c = new THREE.Color();
  for (let iz = 0; iz <= NZ; iz++) {
    const z = -SHORE_SPAN + (iz / NZ) * SHORE_SPAN * 2;
    for (let ix = 0; ix <= NX; ix++) {
      const u = -6 + (ix / NX) * DEPTH;
      pos.push(shoreX(z) + u, coastHeight(u, z), z);
      c.copy(sand).lerp(green, smoothstep(2, 14, u)).lerp(dry, smoothstep(60, 200, u) * (0.5 + 0.5 * Math.sin(z / 50)));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const a = iz * (NX + 1) + ix;
      const b = a + 1;
      const d = a + NX + 1;
      index.push(a, d, b, b, d, d + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = false;
  return m;
}

/** Low buildings along the far shore, in a handful of clusters. Their windows glow with the shore level of the day (see `applyLighting`). */
function buildShoreLights(lite: boolean): THREE.InstancedMesh {
  const rand = rng(11);
  const towns = Array.from({ length: 7 }, () => (rand() * 2 - 1) * (SHORE_SPAN - 60));
  const count = lite ? 120 : 280;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe3dccb,
    roughness: 0.9,
    emissive: 0xffffff,
    emissiveMap: makeWindowMap(),
    emissiveIntensity: 0,
  });
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const town = towns[Math.floor(rand() * towns.length)];
    const z = Math.max(-SHORE_SPAN, Math.min(SHORE_SPAN, town + (rand() + rand() + rand() - 1.5) * 70));
    const u = 6 + rand() * rand() * 40; // crowd the waterfront
    const w = 3 + rand() * 4;
    const h = 2.5 + rand() * rand() * 12;
    const d = 3 + rand() * 4;
    m.compose(
      new THREE.Vector3(shoreX(z) + u, coastHeight(u, z) + h / 2 - 0.2, z),
      new THREE.Quaternion(),
      new THREE.Vector3(w, h, d),
    );
    im.setMatrixAt(i, m);
  }
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  return im;
}

export interface Ocean {
  /** Call once per frame with the running time in seconds. */
  update(t: number): void;
  applyLighting(l: Lighting): void;
  /**
   * Redraws the water's mirror pass on every n-th frame only (the default is every frame; no effect in lite mode).
   * The mirror is the biggest GPU cost in the scene, and a reflection a few frames old is not visible on moving water.
   */
  setReflectionEvery(n: number): void;
}

// Water and haze colours at the two ends of the day.
const WATER_DAY = new THREE.Color(0x0e5568);
const WATER_NIGHT = new THREE.Color(0x03080f);
const FOG_DAY = new THREE.Color(0xb7ccdc);
const FOG_DUSK = new THREE.Color(0xe9a87c);
const FOG_NIGHT = new THREE.Color(0x070c18);

/**
 * Sky, terrace, sea and far shore, all beyond the +x windows. In `lite` mode the water is a still,
 * lit plane (no reflection pass) and the sky has no clouds.
 */
export function buildOcean(scene: THREE.Scene, _renderer: THREE.WebGLRenderer, lite: boolean): Ocean {
  const normals = makeWaterNormals();

  // Sky dome: the shader pins itself to the far plane, so a huge box is fine.
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const su = sky.material.uniforms;
  su.turbidity.value = 4;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.8;
  su.cloudCoverage.value = lite ? 0 : 0.3;
  scene.add(sky);

  scene.fog = new THREE.FogExp2(FOG_DAY, 0.0035); // sea haze; the interior is only ~30 m deep, so it barely touches it

  // The office stands on a concrete pier: a solid base under the floor, with a terrace outside the glass.
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(OFFICE.width / 2 + PIER_END, 3.6, OFFICE.depth),
    new THREE.MeshStandardMaterial({ color: 0x6f706d, roughness: 0.85 }),
  );
  pier.position.set((PIER_END - OFFICE.width / 2) / 2, -0.01 - 1.8, 0);
  pier.castShadow = true;
  pier.receiveShadow = true;
  scene.add(pier);

  const shore = buildShoreLights(lite);
  scene.add(buildCoast(lite), shore);

  // Water. The full version is a mirror-reflecting `Water`; `lite` is a lit plane with the same ripples, held still.
  const WATER_SIZE = 1040;
  const waterGeo = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE);
  let water: Water | undefined;
  let still: THREE.MeshStandardMaterial | undefined;
  let mirrorDone = false;
  let mirrorEvery = 1;
  let tick = 0;

  if (lite) {
    normals.repeat.set(WATER_SIZE / 14, WATER_SIZE / 14);
    still = new THREE.MeshStandardMaterial({ color: WATER_DAY, roughness: 0.12, metalness: 0, normalMap: normals });
    still.normalScale.set(0.35, 0.35);
    const plane = new THREE.Mesh(waterGeo, still);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, WATER_Y, 0);
    scene.add(plane);
  } else {
    water = new Water(waterGeo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: normals,
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff,
      waterColor: WATER_DAY,
      distortionScale: 2.2,
      fog: true,
    });
    water.material.uniforms.size.value = 6;
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, WATER_Y, 0);
    scene.add(water);

    // The glass's transmission pass draws the water too, which would run the mirror render twice a frame. Do it once.
    const mirror = water.onBeforeRender;
    water.onBeforeRender = function (this: Water, ...args: Parameters<typeof mirror>) {
      if (mirrorDone) return;
      mirrorDone = true;
      mirror.apply(this, args);
    };
  }

  const sunDir = new THREE.Vector3();
  const fog = scene.fog as THREE.FogExp2;

  return {
    setReflectionEvery(n: number) {
      mirrorEvery = Math.max(1, Math.round(n) || 1);
    },
    update(t: number) {
      mirrorDone = ++tick % mirrorEvery !== 0;
      su.time.value = t;
      if (water) water.material.uniforms.time.value = t * 0.8;
    },
    applyLighting(l: Lighting) {
      const az = THREE.MathUtils.degToRad(l.sunAzimuthDeg);
      const elReal = THREE.MathUtils.degToRad(l.sunElevationDeg);
      // Same compass-to-world mapping as scene.ts: +z is north, +x is west.
      sunDir.set(-Math.sin(az) * Math.cos(elReal), Math.sin(elReal), Math.cos(az) * Math.cos(elReal));
      su.sunPosition.value.copy(sunDir);
      su.rayleigh.value = lerp(2.6, 0.8, smoothstep(5, 40, l.sunElevationDeg)); // a high sun over-brightens the sky and ACES turns it white

      const day = smoothstep(-4, 18, l.sunElevationDeg);
      const dusk = 1 - Math.abs(smoothstep(-6, 4, l.sunElevationDeg) * 2 - 1); // peaks as the sun meets the horizon
      fog.color.copy(FOG_NIGHT).lerp(FOG_DAY, day).lerp(FOG_DUSK, dusk * 0.7);
      const waterColor = WATER_NIGHT.clone().lerp(WATER_DAY, day);

      if (water) {
        // The glint follows the sun above the horizon, and a faint moon-glint after dark.
        const el = Math.max(l.sunElevationDeg, 6);
        const e = THREE.MathUtils.degToRad(el);
        water.material.uniforms.sunDirection.value.set(-Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e));
        water.material.uniforms.sunColor.value.setHex(l.sunColor).multiplyScalar(Math.min(1, l.sunIntensity));
        water.material.uniforms.waterColor.value.copy(waterColor);
      }
      if (still) still.color.copy(waterColor);

      // Set here rather than through registerGlow, so the ocean follows the day whichever way it is driven.
      (shore.material as THREE.MeshStandardMaterial).emissiveIntensity = SHORE_LIGHT_BASE * l.shoreLights;
    },
  };
}
