// The Beleza Core: a polished amethyst "b" on a low black plinth with a gold rim light. It pulses on approvals and sends.
import * as THREE from 'three';
import { CORE_POSITION } from './layout';

const AMETHYST = 0x8b5cf6;
const GOLD = 0xffc860;
// Sways about facing +z rather than spinning: a full turn shows the back, where the "b" reads as a "d".
const SWAY = 0.45; // rad either side
const SWAY_RATE = 0.25; // rad/s of phase: one sway ≈ 25 s
const SCALE = 0.62; // glyph units are ~2.7 tall; this makes the sculpture ~1.7 m
const PLINTH_H = 0.22;
const PULSE_SECONDS = 1.4;

const REST_EMISSIVE = 0.12;
const REST_LIGHT = 14;

/** The lowercase "b" as one outline with a hole: a bold stem and a round bowl. Origin at the foot of the stem. */
function glyph(): THREE.Shape {
  const stemW = 0.62;
  const cx = 1.12;
  const cy = 0.95;
  const R = 0.95;
  const r = 0.45;
  const dy = Math.sqrt(R * R - (cx - stemW) ** 2); // where the bowl's outer edge meets the stem
  const a = Math.atan2(dy, stemW - cx);

  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0, 2.7);
  s.lineTo(stemW, 2.7);
  s.lineTo(stemW, cy + dy);
  s.absarc(cx, cy, R, a, -a, true); // clockwise over the top, round the right, under the bottom
  s.lineTo(stemW, 0);
  s.lineTo(0, 0);
  const hole = new THREE.Path();
  hole.absarc(cx, cy, r, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

export interface Core {
  group: THREE.Group;
  /** A bright flash through the sculpture and its light; fades in about 1.4 s. */
  pulse(): void;
  /** Call once per frame with the running time in seconds. */
  update(t: number): void;
}

export function buildCore(): Core {
  const group = new THREE.Group();
  group.name = 'core';
  group.position.set(...CORE_POSITION);

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.9, PLINTH_H, 48),
    new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.35, metalness: 0.2 }),
  );
  plinth.position.y = PLINTH_H / 2;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.012, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0xd9ae45, roughness: 0.25, metalness: 1 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = PLINTH_H + 0.006;
  for (const m of [plinth, ring]) { m.castShadow = true; m.receiveShadow = true; }

  // Extruded, with a generous bevel so the edges catch the light like a cut stone.
  const geo = new THREE.ExtrudeGeometry(glyph(), {
    depth: 0.5,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 5,
    curveSegments: 56,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); // stand it on its centre
  const amethyst = new THREE.MeshPhysicalMaterial({
    color: AMETHYST,
    roughness: 0.1,
    metalness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    ior: 1.55,
    emissive: AMETHYST,
    emissiveIntensity: REST_EMISSIVE,
  });
  const glyphMesh = new THREE.Mesh(geo, amethyst);
  glyphMesh.castShadow = true;
  glyphMesh.receiveShadow = true;

  const spinner = new THREE.Group();
  spinner.scale.setScalar(SCALE);
  spinner.position.y = PLINTH_H + 0.012;
  spinner.add(glyphMesh);

  // Gold rim light from behind and to the side, so the edges glow against the purple.
  const rim = new THREE.PointLight(GOLD, REST_LIGHT, 7, 2);
  rim.position.set(0.9, 1.5, -1.1);

  group.add(plinth, ring, spinner, rim);

  let pulseAt = -1;
  let pending = false;

  return {
    group,
    pulse() { pending = true; },
    update(t: number) {
      if (pending) { pulseAt = t; pending = false; }
      spinner.rotation.y = SWAY * Math.sin(t * SWAY_RATE);
      const k = pulseAt < 0 ? 0 : Math.max(0, 1 - (t - pulseAt) / PULSE_SECONDS);
      const e = k * k; // quick flash, slow fade
      amethyst.emissiveIntensity = REST_EMISSIVE + 1.3 * e;
      rim.intensity = REST_LIGHT + 60 * e;
      spinner.scale.setScalar(SCALE * (1 + 0.04 * e));
    },
  };
}
