import { afterEach, describe, expect, it, vi } from 'vitest';
import { hIn } from '../src/dash/dom';
import type { HFn } from '../src/dash/dom';
import {
  CONNECT_STEPS, DEMO_NOTE, STATE_LABEL, STEPS, connectionRows, isStepId, nextStep, prevStep, shouldOpenWelcome, stepIndex, stepState,
} from '../src/dash/onboarding';
import type { ConnState, StepId } from '../src/dash/onboarding';
import { wizardView } from '../src/dash/pages/onboarding';
import type { WizardDeps } from '../src/dash/pages/onboarding';
import { onboarded, setOnboarded } from '../src/dash/prefs';
import { CONNECTIONS } from '../src/dash/settings-data';

const ORDER: StepId[] = ['welcome', 'email', 'socials', 'website', 'whatsapp', 'review'];
const stepOf = (id: StepId) => STEPS.find((s) => s.id === id)!;

// ---------------------------------------------------------------- the steps

describe('STEPS', () => {
  it('runs welcome, email, socials, website, whatsapp, review', () => {
    expect(STEPS.map((s) => s.id)).toEqual(ORDER);
    expect(STEPS.map((s) => stepIndex(s.id))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('gives the four connect steps their exact privacy copy', () => {
    expect(stepOf('email').privacy).toBe('info@belezamedia.com (Afrihost IMAP/SMTP). You type the mailbox password into the Anthropic vault yourself; Beleza HQ never sees it.');
    expect(stepOf('socials').privacy).toBe("Instagram, Facebook and LinkedIn through Composio. You sign in on each network's own page.");
    expect(stepOf('website').privacy).toBe('belezamedia.com: contact-form enquiries become leads, a monthly speed and SEO check, and visit stats (Cloudflare Web Analytics).');
    expect(stepOf('whatsapp').privacy).toBe("Herald's daily report and WhatsApp approvals (stage 4).");
  });

  it('has a title, a needs list and a privacy line on every step, and nothing else', () => {
    for (const s of STEPS) {
      expect(Object.keys(s).sort()).toEqual(['id', 'needs', 'privacy', 'title']);
      expect(s.title.length).toBeGreaterThan(0);
      expect(Array.isArray(s.needs)).toBe(true);
      expect(s.privacy.length).toBeGreaterThan(0);
    }
  });

  it('defines no password, token, key or secret field anywhere', () => {
    const keys = (v: unknown): string[] =>
      Array.isArray(v) ? v.flatMap(keys) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : [];
    for (const k of keys(STEPS)) expect(k).not.toMatch(/password|token|key|secret|credential/i);
    for (const k of keys(STEPS)) expect(['id', 'title', 'needs', 'privacy']).toContain(k);
  });

  it('shows no phone number', () => {
    for (const s of STEPS) for (const text of [s.title, s.privacy, ...s.needs]) expect(text).not.toMatch(/\d[\d\s-]{7,}\d/);
  });

  it('marks exactly the four connect steps', () => {
    expect([...CONNECT_STEPS]).toEqual(['email', 'socials', 'website', 'whatsapp']);
  });
});

describe('nextStep / prevStep / isStepId', () => {
  it('walks forward in order and stops after review', () => {
    expect(nextStep('welcome')).toBe('email');
    expect(nextStep('email')).toBe('socials');
    expect(nextStep('socials')).toBe('website');
    expect(nextStep('website')).toBe('whatsapp');
    expect(nextStep('whatsapp')).toBe('review');
    expect(nextStep('review')).toBeUndefined();
  });

  it('walks back and stops before welcome', () => {
    expect(prevStep('review')).toBe('whatsapp');
    expect(prevStep('email')).toBe('welcome');
    expect(prevStep('welcome')).toBeUndefined();
  });

  it('recognises only real step ids', () => {
    for (const id of ORDER) expect(isStepId(id)).toBe(true);
    for (const bad of ['', 'nope', '__proto__', 'constructor', 'EMAIL', undefined, null, 3]) expect(isStepId(bad)).toBe(false);
  });
});

// ---------------------------------------------------------------- state

describe('stepState', () => {
  it('is needs-server for every connect step on the public demo, whatever connections claim', () => {
    const claims: Partial<Record<StepId, ConnState>> = { email: 'connected', socials: 'error', website: 'connected', whatsapp: 'not-connected' };
    for (const id of CONNECT_STEPS) {
      expect(stepState(id, { live: false, connections: {} })).toBe('needs-server');
      expect(stepState(id, { live: false, connections: claims })).toBe('needs-server');
    }
  });

  it('is not-connected for the welcome and review steps (nothing to connect)', () => {
    for (const live of [false, true]) {
      expect(stepState('welcome', { live, connections: { welcome: 'connected' } })).toBe('not-connected');
      expect(stepState('review', { live, connections: { review: 'connected' } })).toBe('not-connected');
    }
  });

  it('reads the real state when live, and says not-connected for anything unreported', () => {
    const env = { live: true, connections: { email: 'connected', socials: 'error' } as Partial<Record<StepId, ConnState>> };
    expect(stepState('email', env)).toBe('connected');
    expect(stepState('socials', env)).toBe('error');
    expect(stepState('website', env)).toBe('not-connected');
    expect(stepState('whatsapp', env)).toBe('not-connected');
  });

  it('never reports needs-server when live unless the server says so', () => {
    expect(stepState('email', { live: true, connections: { email: 'needs-server' } })).toBe('needs-server');
    expect(stepState('email', { live: true, connections: {} })).not.toBe('needs-server');
  });

  it('labels every state', () => {
    expect(Object.keys(STATE_LABEL).sort()).toEqual(['connected', 'error', 'needs-server', 'not-connected']);
  });
});

describe('connectionRows', () => {
  it('lists every connect step with its state, in order', () => {
    expect(connectionRows({ live: false, connections: {} })).toEqual([
      { id: 'email', title: stepOf('email').title, state: 'needs-server' },
      { id: 'socials', title: stepOf('socials').title, state: 'needs-server' },
      { id: 'website', title: stepOf('website').title, state: 'needs-server' },
      { id: 'whatsapp', title: stepOf('whatsapp').title, state: 'needs-server' },
    ]);
    const live = connectionRows({ live: true, connections: { website: 'connected' } });
    expect(live.map((r) => r.state)).toEqual(['not-connected', 'not-connected', 'connected', 'not-connected']);
  });
});

// ---------------------------------------------------------------- first visit

describe('shouldOpenWelcome', () => {
  it('opens only on a bare landing, and only until onboarded', () => {
    for (const hash of ['', '#', '#/']) {
      expect(shouldOpenWelcome(hash, false)).toBe(true);
      expect(shouldOpenWelcome(hash, true)).toBe(false);
    }
  });

  it('leaves a deep link alone', () => {
    for (const hash of ['#/leads', '#/home', '#/welcome', '#/welcome?step=email', '#/content?agent=muse']) expect(shouldOpenWelcome(hash, false)).toBe(false);
  });
});

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}
afterEach(() => vi.unstubAllGlobals());

describe('onboarded flag', () => {
  it('is false on a first visit and remembered under beleza.hq.onboarded', () => {
    const m = memory();
    vi.stubGlobal('localStorage', m);
    expect(onboarded()).toBe(false);
    setOnboarded();
    expect(m.data['beleza.hq.onboarded']).toBe('1');
    expect(onboarded()).toBe(true);
  });

  it('counts as done when storage is blocked, so a visitor who cannot be remembered is not nagged every time', () => {
    const blocked = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    vi.stubGlobal('localStorage', blocked);
    expect(onboarded()).toBe(true);
    expect(() => setOnboarded()).not.toThrow();
  });
});

// ---------------------------------------------------------------- the rendered wizard (a minimal fake document)

class FakeNode {
  tag?: string;
  data?: string;
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  listeners: Record<string, (() => void)[]> = {};
  constructor(init: { tag?: string; data?: string }) {
    this.tag = init.tag;
    this.data = init.data;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  appendChild(n: FakeNode): FakeNode {
    this.children.push(n);
    return n;
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
}
const fakeDoc = {
  createElement: (tag: string) => new FakeNode({ tag }),
  createTextNode: (data: string) => new FakeNode({ data }),
} as unknown as Pick<Document, 'createElement' | 'createTextNode'>;
const fh: HFn = (tag, attrs, ...children) => hIn(fakeDoc, tag, attrs, ...children) as unknown as HTMLElement;
function walk(n: FakeNode, out: FakeNode[] = []): FakeNode[] {
  out.push(n);
  for (const c of n.children) walk(c, out);
  return out;
}
const nodes = (x: unknown): FakeNode[] => walk(x as FakeNode);
const texts = (x: unknown): string[] => nodes(x).flatMap((n) => (n.data !== undefined ? [n.data] : []));
const byTag = (x: unknown, tag: string): FakeNode[] => nodes(x).filter((n) => n.tag === tag);
const buttonByText = (x: unknown, text: string): FakeNode | undefined =>
  byTag(x, 'button').find((b) => texts(b).join('') === text);

function deps(step: StepId, over: Partial<WizardDeps> = {}): WizardDeps {
  return { step, env: { live: false, connections: {} }, goStep: vi.fn(), done: vi.fn(), ...over };
}

describe('wizardView', () => {
  it('never renders a form field: no input, textarea, select or form, and no password or token attribute', () => {
    for (const id of ORDER) {
      for (const live of [false, true]) {
        const view = wizardView(deps(id, { env: { live, connections: {} } }), fh);
        for (const n of nodes(view)) {
          expect(['input', 'textarea', 'select', 'form']).not.toContain(n.tag);
          expect(Object.keys(n.attrs).join(' ')).not.toMatch(/password|token|secret|apikey|api-key/i);
          expect(Object.values(n.attrs).join(' ')).not.toMatch(/\bpassword\b|\btoken\b/i);
        }
      }
    }
  });

  it('shows the step title, its needs and its privacy line', () => {
    const view = wizardView(deps('email'), fh);
    const t = texts(view);
    expect(t).toContain(stepOf('email').title);
    expect(t).toContain(stepOf('email').privacy);
    for (const need of stepOf('email').needs) expect(t).toContain(need);
  });

  it('draws one progress dot per step with aria-current on the active one only', () => {
    for (const id of ORDER) {
      const view = wizardView(deps(id), fh);
      const dots = nodes(view).filter((n) => (n.attrs.class ?? '').split(' ').includes('ob-dot'));
      expect(dots).toHaveLength(6);
      const current = dots.filter((d) => d.attrs['aria-current'] === 'step');
      expect(current).toHaveLength(1);
      expect(dots.indexOf(current[0])).toBe(stepIndex(id));
    }
  });

  it('on the public demo: Connect and Test connection are disabled and the reason is on screen', () => {
    for (const id of CONNECT_STEPS) {
      const view = wizardView(deps(id), fh);
      const connect = buttonByText(view, 'Connect');
      const test = buttonByText(view, 'Test connection');
      expect(connect?.attrs.disabled).toBeDefined();
      expect(test?.attrs.disabled).toBeDefined();
      expect(texts(view)).toContain(DEMO_NOTE);
      expect(DEMO_NOTE).toBe('Available once the private Beleza HQ server is set up (stage 3)');
    }
  });

  it('when live: Connect is enabled, Test only once something is connected, and the demo note is gone', () => {
    const none = wizardView(deps('email', { env: { live: true, connections: {} } }), fh);
    expect(buttonByText(none, 'Connect')?.attrs.disabled).toBeUndefined();
    expect(buttonByText(none, 'Test connection')?.attrs.disabled).toBeDefined();
    expect(texts(none)).not.toContain(DEMO_NOTE);
    const linked = wizardView(deps('email', { env: { live: true, connections: { email: 'connected' } } }), fh);
    expect(buttonByText(linked, 'Test connection')?.attrs.disabled).toBeUndefined();
  });

  it('has no Connect or Test on welcome and review', () => {
    for (const id of ['welcome', 'review'] as const) {
      const view = wizardView(deps(id), fh);
      expect(buttonByText(view, 'Connect')).toBeUndefined();
      expect(buttonByText(view, 'Test connection')).toBeUndefined();
    }
  });

  it('Next goes to the next step, Back to the previous, Skip past a connect step', () => {
    const d = deps('socials');
    const view = wizardView(d, fh);
    buttonByText(view, 'Next')!.listeners.click[0]();
    buttonByText(view, 'Back')!.listeners.click[0]();
    buttonByText(view, 'Skip')!.listeners.click[0]();
    expect((d.goStep as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(['website', 'email', 'website']);
  });

  it('lets a public visitor skip the welcome step into the demo', () => {
    const d = deps('welcome');
    const view = wizardView(d, fh);
    buttonByText(view, 'Skip — explore the demo')!.listeners.click[0]();
    expect(d.done).toHaveBeenCalledTimes(1);
    expect(buttonByText(view, 'Skip setup')).toBeUndefined();
  });

  it('has no Back on welcome, and finishes from review', () => {
    const w = wizardView(deps('welcome'), fh);
    expect(buttonByText(w, 'Back')).toBeUndefined();
    const d = deps('review');
    const r = wizardView(d, fh);
    expect(buttonByText(r, 'Next')).toBeUndefined();
    expect(buttonByText(r, 'Skip')).toBeUndefined();
    buttonByText(r, 'Done')!.listeners.click[0]();
    expect(d.done).toHaveBeenCalledTimes(1);
  });

  it('review lists every connection with its state', () => {
    const view = wizardView(deps('review'), fh);
    const t = texts(view);
    for (const row of connectionRows({ live: false, connections: {} })) {
      expect(t).toContain(row.title);
    }
    expect(t.filter((x) => x === STATE_LABEL['needs-server'])).toHaveLength(4);
    const live = wizardView(deps('review', { env: { live: true, connections: { email: 'connected', socials: 'error' } } }), fh);
    expect(texts(live)).toContain(STATE_LABEL.connected);
    expect(texts(live)).toContain(STATE_LABEL.error);
    expect(texts(live).filter((x) => x === STATE_LABEL['not-connected'])).toHaveLength(2);
  });

  it('survives a missing or unknown step by showing the welcome step', () => {
    for (const bad of [undefined, 'nope', '__proto__']) {
      const view = wizardView({ ...deps('welcome'), step: bad }, fh);
      expect(texts(view)).toContain(stepOf('welcome').title);
    }
  });

  it('keeps a handler that throws from escaping', () => {
    const d = deps('email', { goStep: () => { throw new Error('boom'); } });
    const view = wizardView(d, fh);
    expect(() => buttonByText(view, 'Next')!.listeners.click[0]()).not.toThrow();
  });
});

// ---------------------------------------------------------------- settings links

describe('CONNECTIONS wizard links', () => {
  it('sends the mail, social and WhatsApp rows to their wizard step', () => {
    const step = (name: RegExp) => CONNECTIONS.find((c) => name.test(c.name))?.step;
    expect(step(/Afrihost/)).toBe('email');
    expect(step(/Composio/)).toBe('socials');
    expect(step(/WhatsApp/)).toBe('whatsapp');
    expect(step(/Higgsfield/)).toBeUndefined();
    expect(step(/Anthropic/)).toBeUndefined();
    for (const c of CONNECTIONS) if (c.step) expect(isStepId(c.step)).toBe(true);
  });
});
