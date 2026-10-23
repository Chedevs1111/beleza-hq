import { describe, it, expect } from 'vitest';
import { nextClip } from '../src/staff/states';
import type { PersonState } from '../src/staff/states';
import manifest from '../public/assets/manifest.json';

const STATES: PersonState[] = ['idle', 'walking', 'sitting', 'typing', 'carrying', 'talking', 'cheering', 'away'];

describe('nextClip', () => {
  it('types on the seated at-table clip, looping', () => {
    expect(nextClip('typing')).toEqual({ clip: 'sit_type', loop: true });
  });

  it('cheers once', () => {
    expect(nextClip('cheering')).toEqual({ clip: 'cheer', loop: false });
  });

  it('maps the other states to their clips', () => {
    expect(nextClip('idle')).toEqual({ clip: 'idle', loop: true });
    expect(nextClip('walking')).toEqual({ clip: 'walk', loop: true });
    expect(nextClip('sitting')).toEqual({ clip: 'sit_idle', loop: true });
    expect(nextClip('carrying')).toEqual({ clip: 'carry', loop: true });
    expect(nextClip('talking')).toEqual({ clip: 'talk', loop: true });
  });

  it('maps every state to one of the 8 clips baked into the avatars', () => {
    const baked = new Set(Object.values(manifest.people)[0].clips);
    expect(baked.size).toBe(8);
    for (const s of STATES) expect(baked.has(nextClip(s).clip)).toBe(true);
  });

  it('only ever plays the cheer once', () => {
    expect(STATES.filter((s) => !nextClip(s).loop)).toEqual(['cheering']);
  });
});
