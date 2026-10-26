import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictationOn, liteOn, pillsOrder, setDictation, setLite, setPillsOrder } from '../src/dash/prefs';
import { DEFAULT_PILLS } from '../src/dash/pills';

const KEY = 'beleza.hq.dictation';

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

afterEach(() => vi.unstubAllGlobals());

describe('dictation preference', () => {
  it('is off by default', () => {
    vi.stubGlobal('localStorage', memory());
    expect(dictationOn()).toBe(false);
  });

  it('is remembered under its own key', () => {
    const m = memory();
    vi.stubGlobal('localStorage', m);
    setDictation(true);
    expect(m.data[KEY]).toBe('1');
    expect(dictationOn()).toBe(true);
    setDictation(false);
    expect(m.data[KEY]).toBe('0');
    expect(dictationOn()).toBe(false);
  });

  it('reads an existing on value', () => {
    vi.stubGlobal('localStorage', memory({ [KEY]: '1' }));
    expect(dictationOn()).toBe(true);
  });

  it('never throws when storage is blocked: off, and the write is just not remembered', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(dictationOn()).toBe(false);
    expect(() => setDictation(true)).not.toThrow();
  });

  it('never throws when the storage object itself cannot be reached', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(dictationOn()).toBe(false);
    expect(() => setDictation(true)).not.toThrow();
  });
});

describe('lite graphics preference', () => {
  it('is undefined (no choice made) by default', () => {
    vi.stubGlobal('localStorage', memory());
    expect(liteOn()).toBeUndefined();
  });

  it('remembers on and off under its own key, and an explicit off is not "no choice"', () => {
    const m = memory();
    vi.stubGlobal('localStorage', m);
    setLite(true);
    expect(m.data['beleza.hq.lite']).toBe('1');
    expect(liteOn()).toBe(true);
    setLite(false);
    expect(m.data['beleza.hq.lite']).toBe('0');
    expect(liteOn()).toBe(false);
  });

  it('treats an unknown stored value as no choice', () => {
    vi.stubGlobal('localStorage', memory({ 'beleza.hq.lite': 'maybe' }));
    expect(liteOn()).toBeUndefined();
  });

  it('never throws when storage is blocked or missing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(liteOn()).toBeUndefined();
    expect(() => setLite(true)).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(liteOn()).toBeUndefined();
    expect(() => setLite(false)).not.toThrow();
  });
});

describe('status pill order preference', () => {
  const KEY_PILLS = 'beleza.hq.pills';

  it('is the default order when nothing is stored', () => {
    vi.stubGlobal('localStorage', memory());
    expect(pillsOrder()).toEqual(DEFAULT_PILLS);
  });

  it('honours a stored order and drops unknown ids and repeats', () => {
    vi.stubGlobal('localStorage', memory({ [KEY_PILLS]: JSON.stringify(['spend', 'bogus', 'leads', 'spend', 7]) }));
    expect(pillsOrder()).toEqual(['spend', 'leads']);
  });

  it('falls back to the default for junk or an order with nothing usable in it', () => {
    for (const raw of ['not json', '{"a":1}', '[]', '["x","y"]']) {
      vi.stubGlobal('localStorage', memory({ [KEY_PILLS]: raw }));
      expect(pillsOrder()).toEqual(DEFAULT_PILLS);
    }
  });

  it('remembers an order under its own key, keeping only known ids', () => {
    const m = memory();
    vi.stubGlobal('localStorage', m);
    setPillsOrder(['next', 'waiting', 'nope' as never]);
    expect(JSON.parse(m.data[KEY_PILLS])).toEqual(['next', 'waiting']);
    expect(pillsOrder()).toEqual(['next', 'waiting']);
  });

  it('never throws when storage is blocked or missing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(pillsOrder()).toEqual(DEFAULT_PILLS);
    expect(() => setPillsOrder(['spend'])).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(pillsOrder()).toEqual(DEFAULT_PILLS);
    expect(() => setPillsOrder(['spend'])).not.toThrow();
  });
});
