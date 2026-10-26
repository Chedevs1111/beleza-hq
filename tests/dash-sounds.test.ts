import { describe, expect, it, vi } from 'vitest';
import { Sounds } from '../src/dash/sounds';
import type { Cue } from '../src/dash/sounds';

const KEY = 'beleza.hq.muted';

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

const CUES: Cue[] = ['pop', 'attention', 'done', 'sent', 'greet', 'think', 'proud', 'annoyed', 'yawn'];

const blocked = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
};

/** A stand-in AudioContext that counts what gets built. */
function fakeAudio(state: AudioContextState = 'running') {
  const made = { nodes: 0, contexts: 0 };
  const node = (): Record<string, unknown> => {
    made.nodes++;
    const param = { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
    const n: Record<string, unknown> = {
      gain: param, frequency: param, Q: param, buffer: null, type: '',
      start: vi.fn(), stop: vi.fn(),
      getChannelData: () => new Float32Array(8),
    };
    n.connect = vi.fn((to: unknown) => to);
    return n;
  };
  const ctx = {
    state, currentTime: 10, sampleRate: 8000, destination: node(),
    resume: vi.fn(() => Promise.resolve()),
    createGain: node, createOscillator: node, createBufferSource: node, createBiquadFilter: node,
    createBuffer: () => { made.nodes++; return { getChannelData: () => new Float32Array(8) }; },
  };
  made.nodes = 0; // the destination above doesn't count
  return { made, ctx, audio: () => { made.contexts++; return ctx as unknown as AudioContext; } };
}

describe('Sounds mute', () => {
  it('starts on, and setMuted persists under beleza.hq.muted', () => {
    const store = memory();
    const s = new Sounds(store);
    expect(s.muted).toBe(false);
    s.setMuted(true);
    expect(s.muted).toBe(true);
    expect(store.data[KEY]).toBeDefined();
    expect(new Sounds(store).muted).toBe(true);
    s.setMuted(false);
    expect(new Sounds(store).muted).toBe(false);
  });

  it('storage that throws never breaks construction, setMuted or play', () => {
    const f = fakeAudio();
    const s = new Sounds(blocked, f.audio);
    expect(s.muted).toBe(false);
    expect(() => s.setMuted(true)).not.toThrow();
    expect(s.muted).toBe(true); // still muted for this visit
    expect(() => s.play('pop')).not.toThrow();
    s.setMuted(false);
    expect(() => s.play('pop')).not.toThrow();
  });

  it('no storage at all is fine', () => {
    const s = new Sounds();
    s.setMuted(true);
    expect(s.muted).toBe(true);
    expect(() => s.play('done')).not.toThrow();
  });
});

describe('Sounds play', () => {
  it('while muted creates no audio context and no nodes', () => {
    const f = fakeAudio();
    const s = new Sounds(memory({ [KEY]: '1' }), f.audio);
    for (const cue of CUES) s.play(cue);
    expect(f.made.contexts).toBe(0);
    expect(f.made.nodes).toBe(0);
  });

  it('while sounding builds nodes for every cue', () => {
    const f = fakeAudio();
    const s = new Sounds(memory(), f.audio);
    s.play('pop');
    expect(f.made.nodes).toBeGreaterThan(0);
    for (const cue of CUES.filter((c) => c !== 'pop')) {
      const before = f.made.nodes;
      s.play(cue);
      expect(f.made.nodes).toBeGreaterThan(before);
    }
  });

  it('stays silent until the browser lets the context run', () => {
    const f = fakeAudio('suspended');
    const s = new Sounds(memory(), f.audio);
    s.play('pop');
    expect(f.made.nodes).toBeLessThanOrEqual(1); // at most the master gain
  });

  it('muting stops further cues', () => {
    const f = fakeAudio();
    const s = new Sounds(memory(), f.audio);
    s.setMuted(true);
    s.play('done');
    expect(f.made.nodes).toBe(0);
  });

  it('muting stops every new cue, even after the context is running', () => {
    const f = fakeAudio();
    const s = new Sounds(memory(), f.audio);
    s.play('pop');
    s.setMuted(true);
    const before = f.made.nodes;
    for (const cue of ['greet', 'think', 'proud', 'annoyed', 'yawn'] as const) s.play(cue);
    expect(f.made.nodes).toBe(before);
  });

  it('the first-input unlock never wakes audio while muted, and still works once unmuted', () => {
    const handlers = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (t: string, h: () => void) => void handlers.set(t, h));
    vi.stubGlobal('removeEventListener', (t: string) => void handlers.delete(t));
    try {
      const f = fakeAudio();
      const s = new Sounds(memory({ [KEY]: '1' }), f.audio);
      handlers.get('pointerdown')?.();
      handlers.get('keydown')?.();
      expect(f.made.contexts).toBe(0);
      expect(f.made.nodes).toBe(0);
      s.setMuted(false);
      handlers.get('pointerdown')?.(); // still listening
      expect(f.made.contexts).toBe(1);
      expect(handlers.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a context factory that throws leaves the dashboard silent, not broken', () => {
    const s = new Sounds(memory(), () => { throw new Error('no web audio'); });
    expect(() => s.play('pop')).not.toThrow();
  });
});
