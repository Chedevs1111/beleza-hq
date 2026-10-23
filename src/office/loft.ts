// The floating timber loft (the Studio) and the terrazzo-and-oak steps that lead up to it.
// Every dimension comes from layout.ts; the loft is open toward +z and has a doorway on the steps side.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OFFICE, STEPS } from './layout';
import type { Materials } from './materials';
import { registerGlow } from './scene';
import { box, finishes, instanced, mesh } from './geo';
import type { Placement } from './geo';

const { x0, x1, z0, z1, floorY, height } = OFFICE.loft;
const TILE_OAK = 1.5; // real-world size of one oak texture repeat, in metres
const TILE_TERRAZZO = 0.7;

const THICK = 0.3; // end and back wall cladding
const SLAB = 0.35; // floor and roof slabs: the chunky frame the photo shows
const ROOF_TOP = floorY + height + SLAB;
const DOOR_W = 1.2;
const DOOR_H = 2.2;

/** The loft's inner point light, at its base level (candela). Follows the interior-light level of the day. */
const LOFT_LIGHT = 90;

/**
 * The suspended oak box of the Studio: floor and roof slabs, back and end walls, a doorway where the steps
 * land, inner downlights, a ledge seat on the open edge, and a short timber bridge from the top tread.
 * Pass `scene` so the inner light follows the time of day.
 */
export function buildLoft(mats: Materials, scene?: THREE.Scene): THREE.Group {
  const loft = new THREE.Group();
  loft.name = 'loft';
  const { oak } = finishes(mats);

  /** An oak slab from corner to corner. */
  const slab = (ax: number, bx: number, ay: number, by: number, az: number, bz: number): THREE.Mesh =>
    mesh(box(bx - ax, by - ay, bz - az, TILE_OAK), oak, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);

  const top = floorY + height;
  const doorZ = STEPS.treads[STEPS.treads.length - 1].position[2];
  loft.add(
    slab(x0, x1, floorY - SLAB, floorY, z0, z1), // floor
    slab(x0, x1, top, ROOF_TOP, z0, z1), // roof
    slab(x0, x1, floorY, top, z0, z0 + THICK), // back wall
    slab(x0, x0 + THICK, floorY, top, z0 + THICK, z1), // end wall, stone-wall side
    // End wall on the steps side, with a doorway at the landing.
    slab(x1 - THICK, x1, floorY, top, z0 + THICK, doorZ - DOOR_W / 2),
    slab(x1 - THICK, x1, floorY, top, doorZ + DOOR_W / 2, z1),
    slab(x1 - THICK, x1, floorY + DOOR_H, top, doorZ - DOOR_W / 2, doorZ + DOOR_W / 2),
  );

  // Ledge seat on the open edge, like the one in the photo.
  const ledge = mesh(box(1.8, 0.42, 0.45, TILE_OAK), oak, 0.6, floorY + 0.21, z1 - 0.225);
  loft.add(ledge);

  // Timber bridge from the top tread to the loft floor, closing the 1 m gap. It starts at the loft edge and its top
  // sits 5 mm low, so no face is coplanar with the loft floor or the tread (which z-fought from above).
  const topTread = STEPS.treads[STEPS.treads.length - 1];
  const bridgeEnd = topTread.position[0] - topTread.size[0] / 2 + 0.05; // tucks under the tread
  loft.add(slab(x1, bridgeEnd, floorY - 0.125, floorY - 0.005, doorZ - 0.5, doorZ + 0.5)); // both faces 5 mm off the tread's: no z-fight above or below

  // Four steel hangers from the ceiling slab.
  const rod = new THREE.CylinderGeometry(0.02, 0.02, OFFICE.ceiling - ROOF_TOP, 8);
  const hangerAt = (x: number, z: number): Placement => [x, (OFFICE.ceiling + ROOF_TOP) / 2, z];
  loft.add(instanced(rod, mats.black, [
    hangerAt(x0 + 0.5, z0 + 0.5), hangerAt(x1 - 0.5, z0 + 0.5),
    hangerAt(x0 + 0.5, z1 - 0.5), hangerAt(x1 - 0.5, z1 - 0.5),
  ], false));

  // Inner spots: small recessed downlights over the desks and the aisle. Their lenses use the LED material.
  const spots: Placement[] = [
    [-6, top - 0.03, -6.6], [-3, top - 0.03, -6.6], [0, top - 0.03, -6.6],
    [-7.5, top - 0.03, -4.6], [-4.5, top - 0.03, -4.6], [-1.5, top - 0.03, -4.6], [1.5, top - 0.03, -4.6],
  ];
  const lens = new THREE.CircleGeometry(0.055, 16);
  lens.rotateX(Math.PI / 2); // faces down
  lens.translate(0, -0.032, 0);
  loft.add(
    instanced(new THREE.CylinderGeometry(0.075, 0.09, 0.06, 16), mats.black, spots, false),
    instanced(lens, mats.led, spots, false),
  );

  const light = new THREE.PointLight(0xffe2b8, LOFT_LIGHT, 12, 2);
  light.position.set((x0 + x1) / 2, top - 1.1, (z0 + z1) / 2);
  loft.add(light);
  if (scene) registerGlow(scene, light, 'interior', LOFT_LIGHT);

  return loft;
}

export interface Steps {
  group: THREE.Group;
  /** Extra warm glow on the LED strips, 0..1, laid on top of the time-of-day level (0 = none). */
  setGlow(v: number): void;
  /** Runs a light up the treads, bottom to top, in 0.8 s. */
  pulse(): void;
}

// Each tread floats on a solid terrazzo block with a slim LED reveal between the two.
const GAP = 0.05; // height of the LED reveal
const INSET = 0.09; // how far the block sits back from the tread edge
const STRIP = 0.04; // width of the glowing line
const PULSE_SECONDS = 0.8;
const PULSE_WIDTH = 0.3; // how long each tread stays lit
const PULSE_STAGGER = (PULSE_SECONDS - PULSE_WIDTH) / (STEPS.treads.length - 1);

/** LED reveal for one tread, in the tread's own coordinates: a line along the front and both sides. `grow` fattens it. */
function ledReveal(size: [number, number, number], grow: number): THREE.BufferGeometry {
  const [w, h, d] = size;
  const gap = GAP + grow;
  const y = -h / 2 - GAP / 2;
  const front = new THREE.BoxGeometry(w - 2 * INSET + grow, gap, STRIP + grow).translate(0, y, d / 2 - INSET - STRIP / 2 + 0.01);
  const side = (sx: number) =>
    new THREE.BoxGeometry(STRIP + grow, gap, d - 2 * INSET + grow).translate(sx * (w / 2 - INSET - STRIP / 2 + 0.01), y, 0);
  return mergeGeometries([front, side(-1), side(1)])!;
}

/** Warm light spilling onto the floor in front of the bottom tread, at its base level (candela). */
const SPILL_LIGHT = 20;

/** Pass `scene` so the floor glow follows the LED level of the day. */
export function buildSteps(mats: Materials, scene?: THREE.Scene): Steps {
  const group = new THREE.Group();
  group.name = 'steps';
  const { oak, terrazzo } = finishes(mats);
  const { treads } = STEPS;
  const size = treads[0].size;
  const [w, h, d] = size;

  group.add(instanced(
    box(w, h, d, TILE_OAK),
    oak,
    treads.map((t) => [t.position[0], t.position[1] - h / 2, t.position[2]]),
  ));

  for (const t of treads) {
    const blockH = t.position[1] - h - GAP;
    group.add(mesh(box(w - 2 * INSET, blockH, d - 2 * INSET, TILE_TERRAZZO), terrazzo, t.position[0], blockH / 2, t.position[2]));
  }

  const centres: Placement[] = treads.map((t) => [t.position[0], t.position[1] - h / 2, t.position[2]]);
  group.add(instanced(ledReveal(size, 0), mats.led, centres, false));

  // Pulse overlay: additive copies of the reveal, one per tread, each with its own opacity.
  const overlayGeo = ledReveal(size, 0.012);
  const overlays = treads.map((_, i) => {
    const m = new THREE.Mesh(overlayGeo, new THREE.MeshBasicMaterial({
      color: 0xffe2a8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    m.position.set(...(centres[i] as [number, number, number]));
    m.visible = false;
    group.add(m);
    return m;
  });

  // The reveal itself casts no light, so a low warm point light stands in for the glow on the floor and the blocks.
  const spill = new THREE.PointLight(0xffa24a, SPILL_LIGHT, 5, 2);
  spill.position.set(treads[0].position[0], 0.3, treads[0].position[2] + 0.9);
  group.add(spill);
  if (scene) registerGlow(scene, spill, 'led', SPILL_LIGHT);

  let base = 0;
  let pulseStart = -1;
  let raf = 0;

  const paint = (seconds: number) => {
    overlays.forEach((m, i) => {
      const x = (seconds - i * PULSE_STAGGER) / PULSE_WIDTH;
      const bump = seconds >= 0 && x > 0 && x < 1 ? Math.sin(Math.PI * x) : 0;
      const level = Math.max(base, bump);
      (m.material as THREE.MeshBasicMaterial).opacity = level;
      m.visible = level > 0.004;
    });
  };

  // Runs in a browser frame loop of its own; the timer fallback keeps it working where there is no rAF (tests).
  const schedule = (cb: (now: number) => void): number =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(cb)
      : (setTimeout(() => cb(performance.now()), 16) as unknown as number);

  const tick = (now: number) => {
    const seconds = (now - pulseStart) / 1000;
    paint(seconds);
    raf = seconds < PULSE_SECONDS ? schedule(tick) : 0;
  };

  return {
    group,
    setGlow(v: number) {
      base = Math.min(1, Math.max(0, v));
      if (!raf) paint(-1);
    },
    pulse() {
      pulseStart = performance.now();
      if (!raf) raf = schedule(tick);
    },
  };
}
