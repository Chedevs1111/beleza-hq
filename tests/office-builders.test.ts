import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createMaterials } from '../src/office/materials';
import { buildLoft, buildSteps } from '../src/office/loft';
import { buildFurniture } from '../src/office/furniture';
import type { ScreenHandle } from '../src/office/furniture';
import { buildCore } from '../src/office/core';
import { buildOcean } from '../src/office/ocean';
import { lightingAt } from '../src/office/timeofday';
import { CORE_POSITION, OFFICE, SEATS, STEPS } from '../src/office/layout';
import { ROSTER } from '../src/roster';

const mats = createMaterials({}, { lite: true });
const bounds = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);

describe('buildLoft', () => {
  const box = bounds(buildLoft(mats));
  const { loft } = OFFICE;

  it('fills the loft footprint from the floor slab up to the roof', () => {
    expect(box.min.x).toBeCloseTo(loft.x0, 1);
    expect(box.min.z).toBeCloseTo(loft.z0, 1);
    expect(box.max.z).toBeCloseTo(loft.z1, 1);
    expect(box.min.y).toBeLessThan(loft.floorY);
    expect(box.max.y).toBeGreaterThan(loft.floorY + loft.height);
  });

  it('bridges the gap from the loft edge to the top tread', () => {
    const top = STEPS.treads[STEPS.treads.length - 1];
    expect(box.max.x).toBeGreaterThan(top.position[0] - top.size[0] / 2);
  });
});

describe('buildSteps', () => {
  it('stands one oak slab per tread, with its top at the walking surface', () => {
    const steps = buildSteps(mats);
    expect(bounds(steps.group).max.y).toBeCloseTo(STEPS.treads[STEPS.treads.length - 1].position[1], 2);
  });

  it('pulse() lights the treads in turn and lets them go dark again', async () => {
    const steps = buildSteps(mats);
    const lit = () => steps.group.children.filter((c) => c instanceof THREE.Mesh && c.material instanceof THREE.MeshBasicMaterial && c.visible).length;
    expect(lit()).toBe(0);
    steps.pulse();
    await new Promise((r) => setTimeout(r, 120));
    expect(lit()).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1000));
    expect(lit()).toBe(0);
  });

  it('setGlow() keeps an extra glow on every tread', () => {
    const steps = buildSteps(mats);
    steps.setGlow(0.5);
    const overlays = steps.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.material instanceof THREE.MeshBasicMaterial);
    expect(overlays).toHaveLength(STEPS.treads.length);
    expect(overlays.every((m) => m.visible && (m.material as THREE.MeshBasicMaterial).opacity === 0.5)).toBe(true);
  });
});

describe('buildFurniture', () => {
  const group = buildFurniture(mats);
  const instanced = group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);

  it('puts a chair and a monitor at every seat', () => {
    const seats = Object.keys(SEATS).length;
    expect(seats).toBe(ROSTER.length);
    expect(instanced.filter((m) => m.count === seats).length).toBeGreaterThanOrEqual(4); // timber, steel, monitor body, screen
  });

  it('exposes each agent\'s screen, standing in front of their seat', () => {
    const { mesh, index } = group.userData.screens as ScreenHandle;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const a of ROSTER) {
      mesh.getMatrixAt(index[a.id], m);
      p.setFromMatrixPosition(m);
      const seat = SEATS[a.id];
      expect(Math.hypot(p.x - seat.position[0], p.z - seat.position[2])).toBeCloseTo(1, 5);
      expect(p.y).toBeCloseTo(seat.position[1] + 0.75, 5);
    }
  });
});

describe('buildCore', () => {
  it('stands at CORE_POSITION and sways without ever turning its back (the "b" must not read as "d")', () => {
    const core = buildCore();
    expect(core.group.position.toArray()).toEqual(CORE_POSITION);
    const spinner = core.group.children.find((c) => c.type === 'Group')!;
    const seen = new Set<number>();
    for (let t = 0; t <= 200; t += 0.5) {
      core.update(t);
      expect(Math.abs(spinner.rotation.y)).toBeLessThanOrEqual(0.45 + 1e-9);
      seen.add(Math.sign(Math.round(spinner.rotation.y * 100)));
    }
    expect(seen.has(1) && seen.has(-1)).toBe(true); // it does move, both ways
  });

  it('pulse() brightens the sculpture, then lets it settle', () => {
    const core = buildCore();
    const glyph = core.group.children.find((c) => c.type === 'Group')!.children[0] as THREE.Mesh;
    const mat = glyph.material as THREE.MeshPhysicalMaterial;
    core.update(10);
    const rest = mat.emissiveIntensity;
    core.pulse();
    core.update(10.1);
    expect(mat.emissiveIntensity).toBeGreaterThan(rest * 3);
    core.update(13);
    expect(mat.emissiveIntensity).toBeCloseTo(rest, 5);
  });
});

describe('buildOcean', () => {
  const renderer = {} as THREE.WebGLRenderer; // the builders only hand it on; nothing renders in a unit test

  it('lights the far shore after dark and not at noon, in both modes', () => {
    for (const lite of [true, false]) {
      const scene = new THREE.Scene();
      const ocean = buildOcean(scene, renderer, lite);
      const shore = scene.children.find((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)!;
      const mat = shore.material as THREE.MeshStandardMaterial;
      ocean.applyLighting(lightingAt(12));
      expect(mat.emissiveIntensity).toBe(0);
      ocean.applyLighting(lightingAt(21));
      expect(mat.emissiveIntensity).toBeGreaterThan(0.5);
    }
  });

  it('points the sky\'s sun the same way the scene\'s sun shines', () => {
    const scene = new THREE.Scene();
    const ocean = buildOcean(scene, renderer, true);
    ocean.applyLighting(lightingAt(17.5)); // sinking in the west, which is +x here
    const sky = scene.children.find((c) => (c as { isSky?: boolean }).isSky) as THREE.Mesh;
    const sun = (sky.material as THREE.ShaderMaterial).uniforms.sunPosition.value as THREE.Vector3;
    expect(sun.x).toBeGreaterThan(0.5);
    expect(sun.y).toBeGreaterThan(0);
  });
});

describe('buildLoft with a scene', () => {
  it('adds an inner point light for the interior level to follow', () => {
    const loft = buildLoft(mats, new THREE.Scene());
    expect(loft.children.some((c) => c instanceof THREE.PointLight)).toBe(true);
  });
});
