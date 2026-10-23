import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROSTER } from '../src/roster';

const PUBLIC = resolve(__dirname, '../public');
const ASSETS = join(PUBLIC, 'assets');
const CLIPS = ['walk', 'sit_idle', 'sit_type', 'idle', 'talk', 'carry', 'wave', 'cheer'];
const TEXTURES = ['concrete', 'oak', 'terrazzo', 'stone', 'floor'];

interface Manifest {
  people: Record<string, { file: string; clips: string[]; triangles: number }>;
  textures: Record<string, { baseColor: string; normal: string; roughness: string }>;
  hdri: string;
  sources: { name: string; url: string; licence: string }[];
}

const manifest: Manifest = JSON.parse(readFileSync(join(ASSETS, 'manifest.json'), 'utf8'));

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}

describe('asset manifest', () => {
  it('lists at least 15 people', () => {
    expect(Object.keys(manifest.people).length).toBeGreaterThanOrEqual(15);
  });

  it('every roster look.model is a people key, and no two agents share one', () => {
    const models = ROSTER.map((a) => a.look.model);
    for (const m of models) expect(Object.keys(manifest.people)).toContain(m);
    expect(new Set(models).size).toBe(models.length);
  });

  it('every person has all 8 clips, <= 15000 triangles and an existing file', () => {
    for (const [key, p] of Object.entries(manifest.people)) {
      expect([...p.clips].sort(), key).toEqual([...CLIPS].sort());
      expect(p.triangles, key).toBeGreaterThan(0);
      expect(p.triangles, key).toBeLessThanOrEqual(15000);
      expect(existsSync(join(PUBLIC, p.file)), `${key} -> ${p.file}`).toBe(true);
    }
  });

  it('has the five textures and an HDRI, all present on disk', () => {
    expect(Object.keys(manifest.textures).sort()).toEqual([...TEXTURES].sort());
    for (const [key, t] of Object.entries(manifest.textures)) {
      for (const f of [t.baseColor, t.normal, t.roughness]) {
        expect(existsSync(join(PUBLIC, f)), `${key} -> ${f}`).toBe(true);
      }
    }
    expect(existsSync(join(PUBLIC, manifest.hdri))).toBe(true);
  });

  it('only uses MIT or CC0 sources', () => {
    expect(manifest.sources.length).toBeGreaterThan(0);
    for (const s of manifest.sources) expect(['MIT', 'CC0']).toContain(s.licence);
  });

  it('keeps public/assets within 60 MB', () => {
    expect(dirSize(ASSETS)).toBeLessThanOrEqual(60 * 1024 * 1024);
  });
});
