// Furniture: long concrete tables, oak desks, a timber-and-steel chair and a monitor at every seat, the indoor tree and plants.
// Everything repeated is instanced (a dozen draw calls for the lot). Positions come from layout.ts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AgentId } from '../types';
import { DESKS, SEATS, TREE_POSITION } from './layout';
import type { DeskRect, Vec3 } from './layout';
import type { Materials } from './materials';
import { box, finishes, instanced } from './geo';
import type { Placement } from './geo';

const TOP_Y = 0.75; // desk and table surface, above the floor they stand on
const TILE_OAK = 1.5;
const TILE_CONCRETE = 1.6;
/** How far a monitor stands in front of its seat, along the facing direction. */
const MONITOR_REACH = 1.0;

/** Reach the screens from outside: `group.userData.screens` maps each agent to a monitor in this instanced mesh. */
export interface ScreenHandle {
  mesh: THREE.InstancedMesh;
  index: Record<AgentId, number>;
}

/** Small deterministic random source, so the foliage looks the same on every load. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const part = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** The timber seat and back of a chair that faces +z, standing on the floor at its origin. */
function chairTimber(): THREE.BufferGeometry {
  const seat = part(box(0.44, 0.035, 0.42, TILE_OAK), 0, 0.4425, 0);
  const back = box(0.42, 0.26, 0.025, TILE_OAK).rotateX(-0.1);
  return mergeGeometries([seat, part(back, 0, 0.74, -0.2)])!;
}

/** The black steel frame: four legs, two side rails and two posts carrying the back. */
function chairSteel(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(part(new THREE.BoxGeometry(0.025, 0.425, 0.025), sx * 0.2, 0.2125, sz * 0.19));
    parts.push(part(new THREE.BoxGeometry(0.02, 0.02, 0.38), sx * 0.2, 0.18, 0));
    parts.push(part(new THREE.BoxGeometry(0.025, 0.36, 0.025), sx * 0.2, 0.64, -0.2));
  }
  return mergeGeometries(parts)!;
}

/** Monitor body (foot, neck and bezel) facing +z, standing on the desk surface at its origin. */
function monitorBody(): THREE.BufferGeometry {
  return mergeGeometries([
    part(new THREE.BoxGeometry(0.22, 0.012, 0.16), 0, 0.006, 0),
    part(new THREE.BoxGeometry(0.04, 0.2, 0.03), 0, 0.11, -0.04),
    part(new THREE.BoxGeometry(0.6, 0.36, 0.03), 0, 0.4, 0),
  ])!;
}

const forward = (facing: number): [number, number] => [Math.sin(facing), Math.cos(facing)];

export function buildFurniture(mats: Materials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'furniture';
  const { oak } = finishes(mats);

  // Long concrete tables for the growth floor: a slab on three solid blocks.
  const tables = DESKS.filter((d) => d.id.startsWith('growth-table'));
  const slabW = tables[0].x1 - tables[0].x0;
  const slabD = tables[0].z1 - tables[0].z0;
  const centre = (d: DeskRect): [number, number] => [(d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2];
  group.add(
    instanced(box(slabW, 0.1, slabD, TILE_CONCRETE), mats.concrete, tables.map((d) => [centre(d)[0], d.y + TOP_Y - 0.05, centre(d)[1]])),
    instanced(
      box(0.9, TOP_Y - 0.1, slabD - 0.2, TILE_CONCRETE),
      mats.concrete,
      tables.flatMap((d) => [-5.4, 0, 5.4].map((dx): Placement => [centre(d)[0] + dx, d.y + (TOP_Y - 0.1) / 2, centre(d)[1]])),
    ),
  );

  // Oak desks on black steel legs: the ops desks (and the Courier's outbox desk), the client desks and the studio desks.
  const desks = DESKS.filter((d) => !d.id.startsWith('growth-table'));
  const tops: Placement[] = [];
  const legs: Placement[] = [];
  for (const d of desks) {
    const [cx, cz] = centre(d);
    tops.push([cx, d.y + TOP_Y - 0.02, cz, 0, d.x1 - d.x0, 1, d.z1 - d.z0]);
    for (const x of [d.x0 + 0.07, d.x1 - 0.07]) {
      for (const z of [d.z0 + 0.07, d.z1 - 0.07]) legs.push([x, d.y + (TOP_Y - 0.04) / 2, z]);
    }
  }
  group.add(
    instanced(box(1, 0.04, 1, TILE_OAK), oak, tops),
    instanced(new THREE.BoxGeometry(0.05, TOP_Y - 0.04, 0.05), mats.black, legs),
  );

  // The Courier's outbox: a shallow black tray at the end of its desk, by the window.
  const courier = DESKS.find((d) => d.id === 'courier')!;
  group.add(instanced(
    new THREE.BoxGeometry(0.34, 0.05, 0.24),
    mats.black,
    [[courier.x1 - 0.3, courier.y + TOP_Y + 0.025, centre(courier)[1]]],
  ));

  // A chair and a monitor at every seat. Chairs face the way the person does; monitors face back at them.
  const seats = Object.values(SEATS);
  group.add(
    instanced(chairTimber(), oak, seats.map((s): Placement => [s.position[0], s.position[1], s.position[2], s.facing])),
    instanced(chairSteel(), mats.black, seats.map((s): Placement => [s.position[0], s.position[1], s.position[2], s.facing])),
  );

  const monitorAt = (s: (typeof seats)[number]): Placement => {
    const [fx, fz] = forward(s.facing);
    return [s.position[0] + fx * MONITOR_REACH, s.position[1] + TOP_Y, s.position[2] + fz * MONITOR_REACH, s.facing + Math.PI];
  };
  const monitors = seats.map(monitorAt);
  group.add(instanced(monitorBody(), mats.black, monitors));

  const screenGeo = new THREE.PlaneGeometry(0.56, 0.32).translate(0, 0.4, 0.0155);
  const screens = instanced(
    screenGeo,
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), // lit by itself, tinted per instance
    monitors,
    false,
  );
  const standby = new THREE.Color(0x1a3446);
  seats.forEach((_, i) => screens.setColorAt(i, standby));
  group.add(screens);
  const index = Object.fromEntries(seats.map((s, i) => [s.agent, i])) as Record<AgentId, number>;
  group.userData.screens = { mesh: screens, index } satisfies ScreenHandle;

  group.add(...buildGreenery(mats));
  return group;
}

// ---------------------------------------------------------------------------
// Indoor tree and plants.

const PLANT_SPOTS: Vec3[] = [
  [-14.2, 0, -7], // by the stone wall, back
  [-14.2, 0, 9.4], // by the entrance
  [14.3, 0, -9.6], // back corner at the glazing
  [3.9, 0, 9.9], // beside the Core
];

interface Branch { from: THREE.Vector3; to: THREE.Vector3 }

/** A pot, a few stems and a cloud of instanced leaves. Returns the meshes to add. */
function buildGreenery(mats: Materials): THREE.Object3D[] {
  const rand = rng(7);
  const stems: THREE.BufferGeometry[] = [];
  const pots: Placement[] = [];
  const leaves: { pos: THREE.Vector3; scale: number; tone: number }[] = [];

  const tube = (points: THREE.Vector3[], radius: number) =>
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, radius, 5);
  const around = (c: THREE.Vector3, r: number) =>
    new THREE.Vector3((rand() - 0.5) * 2 * r, (rand() - 0.5) * 2 * r, (rand() - 0.5) * 2 * r).add(c);

  // The tree: a slim, slightly bowed trunk with branches that fan out into an airy crown.
  const [tx, , tz] = TREE_POSITION;
  const POT_H = 0.5;
  pots.push([tx, POT_H / 2, tz, 0, 0.36, POT_H, 0.36]);
  const trunk = [
    new THREE.Vector3(tx, POT_H, tz),
    new THREE.Vector3(tx + 0.08, 1.6, tz + 0.04),
    new THREE.Vector3(tx - 0.05, 2.7, tz - 0.05),
    new THREE.Vector3(tx + 0.12, 3.9, tz + 0.05),
  ];
  stems.push(tube(trunk, 0.045));
  const branches: Branch[] = [];
  for (let i = 0; i < 7; i++) {
    const t = 0.38 + (i / 6) * 0.6; // along the trunk, low to high
    const base = new THREE.CatmullRomCurve3(trunk).getPoint(t);
    const azimuth = i * 2.4 + rand();
    const reach = 1.15 - t * 0.55 + rand() * 0.3;
    const tip = new THREE.Vector3(Math.cos(azimuth) * reach, 0.35 + rand() * 0.5, Math.sin(azimuth) * reach).add(base);
    branches.push({ from: base, to: tip });
    stems.push(tube([base, base.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.12, 0)), tip], 0.016));
  }
  for (const { from, to } of branches) {
    for (let k = 0; k < 48; k++) {
      leaves.push({ pos: around(from.clone().lerp(to, 0.35 + rand() * 0.65), 0.2), scale: 0.8 + rand() * 0.6, tone: rand() });
    }
  }
  const crown = new THREE.Vector3(tx + 0.12, 3.9, tz + 0.05);
  for (let k = 0; k < 40; k++) leaves.push({ pos: around(crown, 0.3), scale: 0.8 + rand() * 0.5, tone: rand() });

  // Four taller-than-a-desk plants: a pot, three stems, a leafy head.
  for (const [px, , pz] of PLANT_SPOTS) {
    const h = 0.9 + rand() * 0.5;
    pots.push([px, 0.2, pz, 0, 0.2, 0.4, 0.2]);
    for (let s = 0; s < 3; s++) {
      const a = (s / 3) * Math.PI * 2 + rand();
      const tip = new THREE.Vector3(px + Math.cos(a) * 0.14, 0.4 + h, pz + Math.sin(a) * 0.14);
      stems.push(tube([new THREE.Vector3(px, 0.4, pz), tip.clone().setY(0.4 + h * 0.5), tip], 0.012));
      for (let k = 0; k < 22; k++) leaves.push({ pos: around(tip, 0.2), scale: 1.5 + rand() * 0.7, tone: rand() });
    }
  }

  const potMesh = instanced(new THREE.CylinderGeometry(1, 0.85, 1, 24), mats.black, pots);
  const stemMesh = new THREE.Mesh(mergeGeometries(stems)!, new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.9 }));
  stemMesh.castShadow = true;

  // Leaf: a small pointed oval, drawn from its base so it can be turned about its stalk.
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.075, 0.1, 0, 0.22);
  leafShape.quadraticCurveTo(-0.075, 0.1, 0, 0);
  const leafMesh = new THREE.InstancedMesh(
    new THREE.ShapeGeometry(leafShape, 3),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, side: THREE.DoubleSide }),
    leaves.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const dark = new THREE.Color(0x4a7332);
  const light = new THREE.Color(0x86a84e);
  const c = new THREE.Color();
  leaves.forEach((l, i) => {
    e.set((rand() - 0.5) * 2.4, rand() * Math.PI * 2, (rand() - 0.5) * 2.4);
    m.compose(l.pos, q.setFromEuler(e), new THREE.Vector3(l.scale, l.scale, l.scale));
    leafMesh.setMatrixAt(i, m);
    leafMesh.setColorAt(i, c.copy(dark).lerp(light, l.tone));
  });
  leafMesh.instanceMatrix.needsUpdate = true;
  leafMesh.computeBoundingSphere();
  leafMesh.castShadow = true;

  return [potMesh, stemMesh, leafMesh];
}
