import { describe, expect, it, vi } from 'vitest';
import { createListener } from '../src/dash/dictation';
import type { Recognition } from '../src/dash/dictation';

/** A stand-in recogniser that records what it was asked to do and lets the test deliver results. */
function fake(withAbort = true) {
  const made: (Recognition & { started: number; stopped: number; aborted: number })[] = [];
  class Fake {
    lang = '';
    interimResults = false;
    continuous = true;
    started = 0;
    stopped = 0;
    aborted = 0;
    onresult: Recognition['onresult'] = null;
    onerror: Recognition['onerror'] = null;
    onend: Recognition['onend'] = null;
    constructor() { made.push(this as never); }
    start() { this.started++; }
    stop() { this.stopped++; }
  }
  if (withAbort) (Fake.prototype as unknown as { abort(): void }).abort = function (this: { aborted: number }) { this.aborted++; };
  return { Ctor: Fake as unknown as new () => Recognition, made };
}
const heard = (text: string, isFinal: boolean) => ({ results: [{ isFinal, 0: { transcript: text } }] });

describe('createListener', () => {
  it('listens in South African English', () => {
    const { Ctor, made } = fake();
    const l = createListener(Ctor, { onText: vi.fn() });
    l.toggle();
    expect(made[0].lang).toBe('en-ZA');
    expect(made[0].started).toBe(1);
    expect(l.listening()).toBe(true);
  });

  it('stop() ends a live recording at once (abort) and reports not listening', () => {
    const { Ctor, made } = fake();
    const states: boolean[] = [];
    const l = createListener(Ctor, { onText: vi.fn(), onState: (on) => states.push(on) });
    l.toggle();
    l.stop();
    expect(made[0].aborted).toBe(1);
    expect(l.listening()).toBe(false);
    expect(states).toEqual([true, false]);
  });

  it('falls back to stop() where abort is missing, and does nothing when idle', () => {
    const { Ctor, made } = fake(false);
    const l = createListener(Ctor, { onText: vi.fn() });
    l.stop(); // idle: nothing to end
    expect(made).toHaveLength(0);
    l.toggle();
    l.stop();
    expect(made[0].stopped).toBe(1);
  });

  it('delivers nothing that arrives after stop()', () => {
    const { Ctor, made } = fake();
    const onText = vi.fn();
    const l = createListener(Ctor, { onText });
    l.toggle();
    made[0].onresult?.(heard('run sc', false));
    expect(onText).toHaveBeenCalledWith('run sc', false);
    l.stop();
    made[0].onresult?.(heard('run scout', true));
    made[0].onend?.();
    expect(onText).toHaveBeenCalledTimes(1);
  });

  it('a second press asks the browser to finish, and the final text still arrives', () => {
    const { Ctor, made } = fake();
    const onText = vi.fn();
    const l = createListener(Ctor, { onText });
    l.toggle();
    l.toggle();
    expect(made[0].stopped).toBe(1);
    made[0].onresult?.(heard('run scout', true));
    expect(onText).toHaveBeenCalledWith('run scout', true);
  });

  it('can listen again after stop()', () => {
    const { Ctor, made } = fake();
    const l = createListener(Ctor, { onText: vi.fn() });
    l.toggle();
    l.stop();
    l.toggle();
    expect(made).toHaveLength(2);
    expect(l.listening()).toBe(true);
  });
});
