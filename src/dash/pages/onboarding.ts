// The welcome wizard: one glass page, six steps, progress dots, Back / Next / Skip. Stage 2 is screens only: on the
// public demo every Connect and Test connection button is switched off and says why. No step has a form field of any
// kind; the mailbox password goes into the Anthropic vault and the social networks sign in on their own pages.
import { h } from '../dom';
import type { HFn } from '../dom';
import {
  CONNECT_STEPS, DEMO_NOTE, STATE_LABEL, STEPS, connectionRows, isStepId, nextStep, prevStep, stepIndex, stepState,
} from '../onboarding';
import type { ConnState, OnboardingEnv, StepId } from '../onboarding';
import { chip, pageTitle, safely } from './common';

export interface WizardDeps {
  /** From `#/welcome?step=...`; anything unknown shows the first step. */
  step?: string;
  env: OnboardingEnv;
  /** Moves the wizard to another step. */
  goStep(id: StepId): void;
  /** Leaves the wizard for Home. */
  done(): void;
  /** Stage 3 hooks: start linking, or check a link. Only reachable when the server is live. */
  onConnect?(id: StepId): void;
  onTest?(id: StepId): void;
}

const TONE: Record<ConnState, string> = { 'not-connected': 'new', 'needs-server': 'gold', connected: 'ok', error: 'warn' };
const stateChip = (state: ConnState, hf: HFn): HTMLElement => chip(STATE_LABEL[state], TONE[state], hf);
const stepHash = (id: StepId): string => (id === 'welcome' ? '#/welcome' : `#/welcome?step=${id}`);

/** The whole wizard for one step, built with `hf` (the tests pass a fake document's). */
export function wizardView(deps: WizardDeps, hf: HFn = h): HTMLElement {
  const id: StepId = isStepId(deps.step) ? deps.step : 'welcome';
  const step = STEPS[stepIndex(id)];
  const { env } = deps;
  const connects = CONNECT_STEPS.includes(id);
  const state = stepState(id, env);
  const locked = connects && state === 'needs-server';
  const next = nextStep(id);
  const prev = prevStep(id);

  const button = (label: string, cls: string, fn: () => void, disabled = false, describedBy?: string): HTMLElement => {
    const b = hf('button', {
      type: 'button',
      class: cls,
      ...(disabled ? { disabled: '' } : {}),
      ...(disabled && describedBy ? { 'aria-describedby': describedBy } : {}),
    }, label);
    b.addEventListener('click', safely(`onboarding ${label}`, fn));
    return b;
  };

  const dots = hf('ol', { class: 'ob-dots', 'aria-label': 'Setup progress' },
    ...STEPS.map((s, i) => {
      const current = s.id === id;
      return hf('li', { class: 'ob-dot-item' },
        hf('a', {
          class: `ob-dot${i < stepIndex(id) ? ' ob-dot-done' : ''}`,
          href: stepHash(s.id),
          'aria-label': `Step ${i + 1} of ${STEPS.length}: ${s.title}`,
          ...(current ? { 'aria-current': 'step' } : {}),
        }, String(i + 1)));
    }),
  );

  const body: HTMLElement[] = [];
  if (step.needs.length > 0) {
    body.push(hf('h2', { class: 'pg-h2' }, 'What you need'), hf('ul', { class: 'ob-needs' }, ...step.needs.map((n) => hf('li', {}, n))));
  }
  body.push(hf('h2', { class: 'pg-h2' }, 'Privacy'), hf('p', { class: 'ob-privacy' }, step.privacy));

  if (connects) {
    const noteId = 'ob-lock-note';
    body.push(hf('div', { class: 'ob-connect' },
      hf('div', { class: 'ob-state' }, hf('span', { class: 'ob-state-label' }, 'Status'), stateChip(state, hf)),
      hf('div', { class: 'ob-actions-inline' },
        button('Connect', 'pg-btn pg-btn-gold', () => deps.onConnect?.(id), locked, noteId),
        button('Test connection', 'pg-btn', () => deps.onTest?.(id), state !== 'connected' && state !== 'error', noteId),
      ),
      ...(locked ? [hf('p', { class: 'ob-lock', id: noteId }, DEMO_NOTE)] : []),
    ));
  }

  if (id === 'review') {
    body.push(hf('ul', { class: 'st-list ob-review', role: 'list', 'aria-label': 'Connections' },
      ...connectionRows(env).map((r) => hf('li', { class: 'st-row' },
        hf('div', { class: 'st-row-text' },
          hf('p', { class: 'st-label' }, r.title),
          hf('a', { class: 'ob-edit', href: stepHash(r.id) }, 'Set up')),
        stateChip(r.state, hf))),
    ));
  }

  const nav: HTMLElement[] = [];
  if (prev) nav.push(button('Back', 'pg-btn ob-back', () => deps.goStep(prev)));
  if (id === 'welcome') nav.push(button('Skip — explore the demo', 'pg-btn', () => deps.done()));
  else if (next && connects) nav.push(button('Skip', 'pg-btn', () => deps.goStep(next)));
  if (next) nav.push(button('Next', 'pg-btn pg-btn-gold', () => deps.goStep(next)));
  else nav.push(button('Done', 'pg-btn pg-btn-gold', () => deps.done()));

  return hf('section', { class: 'pg ob' },
    hf('header', { class: 'pg-head' },
      hf('div', { class: 'pg-head-text' },
        pageTitle(step.title, hf),
        hf('p', { class: 'pg-sub' }, `Step ${stepIndex(id) + 1} of ${STEPS.length}`))),
    dots,
    hf('div', { class: 'ob-panel' }, ...body),
    hf('div', { class: 'ob-nav' }, ...nav),
  );
}

export function renderOnboarding(host: HTMLElement, deps: WizardDeps): () => void {
  host.replaceChildren(wizardView(deps));
  return () => {};
}
