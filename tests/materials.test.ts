import { describe, it, expect } from 'vitest';
import { materialSpec } from '../src/office/materials';
import type { MaterialKey } from '../src/office/materials';

const KEYS: MaterialKey[] = ['concrete', 'oak', 'terrazzo', 'stone', 'floor', 'metal', 'led', 'glass'];

describe('materialSpec', () => {
  it('polishes the floor but leaves the concrete raw', () => {
    const floor = materialSpec('floor').roughness;
    expect(floor).toBeGreaterThanOrEqual(0.15);
    expect(floor).toBeLessThanOrEqual(0.35);
    expect(materialSpec('concrete').roughness).toBeGreaterThanOrEqual(0.7);
  });

  it('makes the LED strip a warm amber emitter', () => {
    const e = materialSpec('led').emissive;
    expect(e).toBeDefined();
    const r = (e! >> 16) & 0xff;
    const g = (e! >> 8) & 0xff;
    const b = e! & 0xff;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('lets the glass transmit nearly all light', () => {
    expect(materialSpec('glass').transmission).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps everything but metal non-metallic', () => {
    for (const key of KEYS) {
      const { metalness } = materialSpec(key);
      if (key === 'metal') expect(metalness).toBeGreaterThanOrEqual(0.6);
      else expect(metalness).toBeLessThanOrEqual(0.2);
    }
  });

  it('gives every material a colour and roughness in range', () => {
    for (const key of KEYS) {
      const s = materialSpec(key);
      expect(Number.isInteger(s.color)).toBe(true);
      expect(s.roughness).toBeGreaterThanOrEqual(0);
      expect(s.roughness).toBeLessThanOrEqual(1);
    }
  });
});
