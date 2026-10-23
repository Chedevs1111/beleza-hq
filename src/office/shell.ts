// The empty concrete shell: floor, board-formed ceiling and columns, ducts, track lighting, stone wall, glazing.
// Dimensions come from layout.ts; the front (+z) is left open for the home camera.
import * as THREE from 'three';
import { OFFICE } from './layout';
import type { Vec3 } from './layout';
import type { Materials } from './materials';
import { registerGlow } from './scene';

const HALF_W = OFFICE.width / 2;
const HALF_D = OFFICE.depth / 2;
const H = OFFICE.ceiling;
const WALL = 0.4; // wall and slab thickness
const SLAB = 0.4;

// Real-world size of one texture repeat, in metres.
const TILE = { concrete: 1.6, stone: 2, floor: 3 }; // concrete map holds 4 boards → ~40 cm board-form without distance moiré

/** A box whose UVs are scaled to world metres, so textures keep their scale on every face. */
function box(w: number, h: number, d: number, tile: number): THREE.BoxGeometry {
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

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

interface Fixture {
  /** Which rail (its z) and where along it (x). */
  rail: number;
  x: number;
  aim: Vec3;
  /** Gets a real SpotLight; the others are housings only. */
  light?: 'full' | 'lite';
}

const RAIL_Y = H - 0.05;
const RAIL_ZS = [-5.35, 0, 5.35];
const FIXTURES: Fixture[] = [
  { rail: 5.35, x: -9, aim: [-6, 0.8, 3.5] },
  { rail: 5.35, x: -5, aim: [-3, 0.8, 5], light: 'lite' }, // growth tables
  { rail: 5.35, x: -1, aim: [-1, 0.8, 6] },
  { rail: 5.35, x: 3, aim: [2, 0.8, 4.5], light: 'full' },
  { rail: 0, x: -11, aim: [-14, 1.4, 3.8], light: 'lite' }, // stone wall and client desks
  { rail: 0, x: -6, aim: [-5, 0.8, 2.4] },
  { rail: 0, x: 0, aim: [0, 0.8, 3.2] },
  { rail: 0, x: 4.4, aim: [4.6, 1.5, -2], light: 'lite' }, // steps
  { rail: 0, x: 8.5, aim: [11.4, 0.8, 3.6], light: 'full' }, // courier desk
  { rail: 0, x: 12, aim: [13.6, 0, 2] },
  { rail: -5.35, x: -11, aim: [-14.5, 2.5, -5], light: 'full' }, // stone wall wash
  { rail: -5.35, x: 5.5, aim: [5, 0.5, -8] },
  { rail: -5.35, x: 8.5, aim: [8.5, 0.8, -4.6], light: 'lite' }, // ops
  { rail: -5.35, x: 11.6, aim: [11.6, 0.8, -8.5] },
];
const SPOT_INTENSITY = 250; // candela at full interior light

export function buildShell(scene: THREE.Scene, mats: Materials): THREE.Group {
  const shell = new THREE.Group();
  shell.name = 'shell';
  const lite = mats.glass.transparent; // createMaterials swaps transmission for transparency in lite mode

  // Polished floor.
  const floorGeo = new THREE.PlaneGeometry(OFFICE.width, OFFICE.depth);
  const floorUv = floorGeo.attributes.uv;
  for (let i = 0; i < floorUv.count; i++) {
    floorUv.setXY(i, (floorUv.getX(i) * OFFICE.width) / TILE.floor, (floorUv.getY(i) * OFFICE.depth) / TILE.floor);
  }
  const floor = mesh(floorGeo, mats.floor, 0, 0, 0, false);
  floor.rotation.x = -Math.PI / 2;
  shell.add(floor);

  // Ceiling slab (open at the front), with downstand beams running toward the windows.
  shell.add(mesh(box(OFFICE.width + 2 * WALL, SLAB, OFFICE.depth + WALL, TILE.concrete), mats.concrete, 0, H + SLAB / 2, -WALL / 2));
  for (const z of [-8, -2.7, 2.7, 8]) {
    shell.add(mesh(box(OFFICE.width - 0.4, 0.7, 0.5, TILE.concrete), mats.concrete, 0, H - 0.35, z));
  }

  // Back wall in raw concrete, stone feature wall at -x.
  shell.add(mesh(box(OFFICE.width + 2 * WALL, H + SLAB, WALL, TILE.concrete), mats.concrete, 0, (H + SLAB) / 2, -HALF_D - WALL / 2));
  shell.add(mesh(box(WALL, H + SLAB, OFFICE.depth, TILE.stone), mats.stone, -HALF_W - WALL / 2, (H + SLAB) / 2, 0));

  // Board-formed columns: pilasters along the back wall and at the open front corners.
  const COL = 0.6;
  const colGeo = box(COL, H, COL, TILE.concrete);
  for (const x of [-14.6, -8, -2, 4, 10, 14.6]) shell.add(mesh(colGeo, mats.concrete, x, H / 2, -HALF_D + COL / 2));
  for (const x of [-14.6, 14.6]) shell.add(mesh(colGeo, mats.concrete, x, H / 2, HALF_D - COL / 2));

  // Exposed ducts: a round trunk running into a rectangular run front to back, and a small one by the stone wall.
  const trunk = new THREE.CylinderGeometry(0.28, 0.28, 22.6, 32);
  trunk.rotateZ(Math.PI / 2);
  shell.add(mesh(trunk, mats.metal, -3.3, 6.3, 0));
  shell.add(mesh(new THREE.BoxGeometry(1, 0.5, OFFICE.depth - 0.8), mats.metal, 8.5, 6.45, 0));
  const small = new THREE.CylinderGeometry(0.18, 0.18, OFFICE.depth - 0.8, 24);
  small.rotateX(Math.PI / 2);
  shell.add(mesh(small, mats.metal, -11.5, 6.45, 0));

  // Black track rails, spot housings and the lights themselves.
  const railGeo = new THREE.BoxGeometry(26, 0.06, 0.06);
  for (const z of RAIL_ZS) shell.add(mesh(railGeo, mats.black, 0, RAIL_Y, z, false));

  const lens = mats.led.clone(); // own material: the lens glows white-warm, the strips glow amber
  lens.emissive.setHex(0xfff0d8);
  lens.color.setHex(0xfff0d8);
  registerGlow(scene, lens, 'interior', 3);
  registerGlow(scene, mats.led, 'led', 2);

  const stem = new THREE.BoxGeometry(0.03, 0.2, 0.03);
  const housing = new THREE.CylinderGeometry(0.07, 0.09, 0.24, 16);
  housing.rotateX(Math.PI / 2); // axis along +z, so lookAt() points the lens
  const lensGeo = new THREE.CircleGeometry(0.065, 16);
  lensGeo.translate(0, 0, 0.121);
  for (const f of FIXTURES) {
    const unit = new THREE.Group();
    unit.position.set(f.x, RAIL_Y - 0.2, f.rail);
    unit.add(mesh(housing, mats.black, 0, 0, 0, false), mesh(lensGeo, lens, 0, 0, 0, false));
    unit.lookAt(...f.aim);
    shell.add(unit, mesh(stem, mats.black, f.x, RAIL_Y - 0.1, f.rail, false));

    if (f.light && (!lite || f.light === 'lite')) {
      const spot = new THREE.SpotLight(0xffe2b8, SPOT_INTENSITY, 0, 0.55, 0.7, 2);
      spot.position.copy(unit.position);
      spot.target.position.set(...f.aim);
      shell.add(spot, spot.target);
      registerGlow(scene, spot, 'interior', SPOT_INTENSITY);
    }
  }

  // Tall glazing at +x: one transmissive pane, slim black mullions every 2 m and a transom at mid-height.
  const pane = new THREE.PlaneGeometry(OFFICE.depth, H);
  pane.rotateY(-Math.PI / 2); // faces into the room
  const glass = new THREE.Mesh(pane, mats.glass);
  glass.position.set(OFFICE.windowsX, H / 2, 0);
  shell.add(glass);

  const mullion = new THREE.BoxGeometry(0.14, H, 0.08);
  for (let z = -HALF_D; z <= HALF_D + 1e-6; z += 2) shell.add(mesh(mullion, mats.black, OFFICE.windowsX, H / 2, z));
  const transom = new THREE.BoxGeometry(0.14, 0.08, OFFICE.depth);
  shell.add(mesh(transom, mats.black, OFFICE.windowsX, H / 2, 0));
  const rail = new THREE.BoxGeometry(0.2, 0.1, OFFICE.depth);
  shell.add(mesh(rail, mats.black, OFFICE.windowsX, 0.05, 0), mesh(rail, mats.black, OFFICE.windowsX, H - 0.05, 0));

  scene.add(shell);
  return shell;
}
