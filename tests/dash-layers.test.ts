import { describe, expect, it, vi } from 'vitest';
import { Layers, escapeDecision } from '../src/dash/layers';

const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;
const body = el('BODY');
const textarea = el('TEXTAREA');
const input = el('INPUT');
const editable = el('DIV', true);

describe('Layers', () => {
  it('tracks the top layer and unregisters', () => {
    const l = new Layers();
    expect(l.top()).toBeUndefined();
    const off = l.push('card', () => {});
    l.push('editor', () => {});
    expect(l.top()).toBe('editor');
    off();
    expect(l.top()).toBe('editor');
    l.handleEscape(body, () => {});
    expect(l.top()).toBeUndefined();
  });

  it('Esc closes only the topmost layer: palette over editor over card', () => {
    const l = new Layers();
    const closed: string[] = [];
    for (const n of ['card', 'editor', 'palette']) l.push(n, () => closed.push(n));
    const home = vi.fn();
    expect(l.handleEscape(body, home)).toBe(true);
    expect(closed).toEqual(['palette']);
    expect(l.top()).toBe('editor');
    expect(l.handleEscape(body, home)).toBe(true);
    expect(l.handleEscape(body, home)).toBe(true);
    expect(closed).toEqual(['palette', 'editor', 'card']);
    expect(home).not.toHaveBeenCalled();
  });

  it('Esc in a textarea with the editor open closes nothing', () => {
    const l = new Layers();
    const close = vi.fn();
    const home = vi.fn();
    l.push('card', () => {});
    l.push('editor', close);
    for (const t of [textarea, input, editable]) expect(l.handleEscape(t, home)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(home).not.toHaveBeenCalled();
    expect(l.top()).toBe('editor');
  });

  it('a palette may close while typing in its own input', () => {
    const l = new Layers();
    const close = vi.fn();
    l.push('card', () => {});
    l.push('palette', close);
    expect(l.handleEscape(input, () => {})).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(l.top()).toBe('card');
  });

  it('no layers: a non-text target calls home once; a text target does not', () => {
    const l = new Layers();
    const home = vi.fn();
    expect(l.handleEscape(body, home)).toBe(true);
    expect(home).toHaveBeenCalledTimes(1);
    expect(l.handleEscape(null, home)).toBe(true);
    expect(home).toHaveBeenCalledTimes(2);
    expect(l.handleEscape(textarea, home)).toBe(false);
    expect(home).toHaveBeenCalledTimes(2);
  });

  it('home is not called when a layer closed', () => {
    const l = new Layers();
    l.push('card', () => {});
    const home = vi.fn();
    l.handleEscape(body, home);
    expect(home).not.toHaveBeenCalled();
  });

  it('the unregister function is idempotent and removes only its own layer', () => {
    const l = new Layers();
    const offA = l.push('a', () => {});
    l.push('b', () => {});
    offA();
    offA();
    expect(l.top()).toBe('b');
    const close = vi.fn();
    const l2 = new Layers();
    const off = l2.push('card', close);
    l2.handleEscape(body, () => {});
    off(); // already closed by Esc
    expect(close).toHaveBeenCalledTimes(1);
    const again = l2.push('card', () => {});
    off(); // stale handle must not remove the newer layer
    expect(l2.top()).toBe('card');
    again();
    expect(l2.top()).toBeUndefined();
  });

  it('a layer removed while its close runs is not closed twice', () => {
    const l = new Layers();
    let off: () => void = () => {};
    const close = vi.fn(() => off());
    off = l.push('card', close);
    l.handleEscape(body, () => {});
    expect(close).toHaveBeenCalledTimes(1);
    expect(l.top()).toBeUndefined();
  });
});

describe('escapeDecision (the global handler stops the event so the card\'s own Esc listener never runs)', () => {
  // Mirrors main.ts: decide from the top layer before handleEscape, and its result.
  const run = (l: Layers, target: EventTarget | null) => {
    const top = l.top();
    return escapeDecision(top, l.handleEscape(target, () => {}));
  };

  it('card plus a layer above it: the event is stopped and cancelled, and only the upper layer closes', () => {
    const l = new Layers();
    const card = vi.fn();
    l.push('card', card);
    l.push('palette', () => {});
    expect(run(l, body)).toEqual({ stop: true, prevent: true });
    expect(card).not.toHaveBeenCalled();
    expect(l.top()).toBe('card');
  });

  it('textarea with the card open: refused, but still stopped so the card stays open', () => {
    const l = new Layers();
    const card = vi.fn();
    l.push('card', card);
    expect(run(l, textarea)).toEqual({ stop: true, prevent: false });
    expect(card).not.toHaveBeenCalled();
  });

  it('only the card open: it closes through the layer, and the event is stopped', () => {
    const l = new Layers();
    const card = vi.fn();
    l.push('card', card);
    expect(run(l, body)).toEqual({ stop: true, prevent: true });
    expect(card).toHaveBeenCalledTimes(1);
  });

  it('no layers: nothing is stopped or cancelled (home runs, nothing else is listening)', () => {
    expect(run(new Layers(), body)).toEqual({ stop: false, prevent: false });
    expect(run(new Layers(), textarea)).toEqual({ stop: false, prevent: false });
  });
});
