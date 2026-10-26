// Settings: connections (none live yet), timetables with Pause and Run now, the rules Sentinel applies, approval modes,
// and the Sounds, Dictation and Lite graphics switches. Everything here is demo-mode and in memory except the three
// switches, which main.ts remembers in this browser.
import { h } from '../dom';
import type { HFn } from '../dom';
import { RING } from '../team';
import type { Agent, AgentId } from '../../types';
import {
  APPROVAL_MODES, BRAND_RULES, CONNECTIONS, DICTATION_NOTE, NOT_CONNECTED, PAUSE_NOTE, SCHEDULES, reasonText, whyNotRunnable,
} from '../settings-data';
import { chip, pageTitle, safely } from './common';
import type { PageDeps } from './common';

/** One preference the page can read and change. `set` does the real work (and remembers it); `get` says what is true now. */
export interface Toggle {
  get(): boolean;
  set(on: boolean): void;
}

export interface SettingsDeps extends PageDeps {
  roster: readonly Agent[];
  /** Agents whose timetable is paused. Shared with the actions' `paused` check, so a change here takes effect at once. */
  paused: Set<AgentId>;
  sound: Toggle;
  dictation: Toggle;
  lite: Toggle;
}

interface Switch {
  el: HTMLElement;
  sync(): void;
}

/** A labelled on/off switch: a real button with role="switch" and aria-checked, named by the visible label (WCAG 2.5.3). */
export function switchRow(id: string, label: string, note: string, toggle: Toggle, after?: HTMLElement, hf: HFn = h): Switch {
  const labelId = `st-${id}-label`;
  const state = hf('span', { class: 'st-switch-state' }, 'Off');
  const button = hf('button', { type: 'button', class: 'st-switch', role: 'switch', 'aria-checked': 'false', 'aria-labelledby': labelId, id: `st-${id}` },
    hf('span', { class: 'st-knob', 'aria-hidden': 'true' }),
    state,
  );
  const sync = (): void => {
    const on = toggle.get();
    button.setAttribute('aria-checked', String(on));
    state.textContent = on ? 'On' : 'Off';
  };
  button.addEventListener('click', safely(`${id} switch`, () => {
    toggle.set(!toggle.get());
    sync();
  }));
  const text = hf('div', { class: 'st-row-text' },
    hf('p', { class: 'st-label', id: labelId }, label),
    hf('p', { class: 'st-note' }, note),
    ...(after ? [after] : []),
  );
  sync();
  return { el: hf('li', { class: 'st-row' }, text, button), sync };
}

const section = (title: string, intro: string | undefined, ...children: (Node | string)[]): HTMLElement =>
  h('section', { class: 'pg-block st-section' }, h('h2', { class: 'pg-h2' }, title), ...(intro ? [h('p', { class: 'st-intro' }, intro)] : []), ...children);

export function renderSettings(host: HTMLElement, deps: SettingsDeps): () => void {
  const { store, actions, roster, paused } = deps;

  // ---- Connections
  const connections = h('ul', { class: 'st-list', role: 'list', 'aria-label': 'Connections' },
    ...CONNECTIONS.map((c) => h('li', { class: 'st-row' },
      h('div', { class: 'st-row-text' }, h('p', { class: 'st-label' }, c.name), h('p', { class: 'st-note' }, c.used)),
      ...(c.step ? [h('a', { class: 'pg-btn st-setup', href: `#/welcome?step=${c.step}`, 'aria-label': `Set up ${c.name}` }, 'Set up')] : []),
      chip(NOT_CONNECTED, 'new'),
    )),
  );

  // ---- Timetables
  const message = h('p', { class: 'st-message', role: 'status', 'aria-live': 'polite' });
  const rowSyncs: (() => void)[] = [];
  const timetableRows = roster.map((a) => {
    const parked = a.parked === true;
    const statusChip = h('span', { class: 'pg-chip' });
    const pause = h('button', { type: 'button', class: 'pg-btn st-pause', 'aria-pressed': 'false', 'aria-label': `Pause ${a.name}` }, 'Pause');
    const run = h('button', { type: 'button', class: 'pg-btn', 'aria-label': `Run ${a.name} now` }, 'Run now');
    const sync = (): void => {
      let label: string;
      let tone: string;
      if (parked) { label = 'Parked'; tone = 'new'; }
      else if (paused.has(a.id)) { label = 'Paused'; tone = 'warn'; }
      else {
        const status = store.statusOf(a.id);
        label = RING[status].label;
        tone = status === 'working' ? 'kind' : status === 'waiting' ? 'gold' : status === 'failed' ? 'warn' : 'new';
      }
      statusChip.className = `pg-chip pg-tone-${tone}`;
      statusChip.textContent = label;
      pause.setAttribute('aria-pressed', String(paused.has(a.id)));
      pause.textContent = paused.has(a.id) ? 'Paused' : 'Pause';
    };
    rowSyncs.push(sync);
    pause.addEventListener('click', safely(`pause ${a.id}`, () => {
      if (paused.has(a.id)) paused.delete(a.id);
      else paused.add(a.id);
      sync();
      message.textContent = paused.has(a.id) ? PAUSE_NOTE : `${a.name} is running on its timetable again.`;
    }));
    run.addEventListener('click', safely(`run ${a.id}`, () => {
      if (actions.runNow(a.id) !== undefined) {
        message.textContent = `${a.name} has started a run.`;
        return;
      }
      const reason = whyNotRunnable(a.id, { store, roster, paused }) ?? 'Already working';
      message.textContent = reasonText(a.name, reason, a.parkedReason);
    }));
    sync();
    return h('tr', { class: 'pg-tr', 'data-id': a.id },
      h('th', { scope: 'row', class: 'pg-th-row' }, a.name),
      h('td', {}, SCHEDULES[a.id]),
      h('td', {}, statusChip),
      h('td', { class: 'st-actions' }, ...(parked ? [] : [pause, run])),
    );
  });
  const timetable = h('table', { class: 'pg-table st-table' },
    h('caption', { class: 'pg-sr' }, 'Timetables'),
    h('thead', {}, h('tr', {}, ...['Agent', 'When', 'Status', 'Controls'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...timetableRows),
  );
  const timetableScroll = h('div', { class: 'pg-scroll', tabindex: '0', role: 'region', 'aria-label': 'Timetables table' }, timetable);

  // ---- Brand & rules, approval modes
  const rules = h('ul', { class: 'st-rules' }, ...BRAND_RULES.map((r) => h('li', {}, r)));
  const modes = h('ul', { class: 'st-list', role: 'list', 'aria-label': 'Approval modes' },
    ...APPROVAL_MODES.map((m) => h('li', { class: 'st-row' },
      h('div', { class: 'st-row-text' }, h('p', { class: 'st-label' }, m.name), h('p', { class: 'st-note' }, m.note)),
      chip(m.later ?? 'Available', m.later ? 'new' : 'ok'),
    )),
  );

  // ---- Switches
  const switches = [
    switchRow('sound', 'Sounds', 'Soft cues when work arrives, finishes or is sent.', deps.sound),
    switchRow('dictation', 'Dictation', `Speak commands in the command bar. ${DICTATION_NOTE}`, deps.dictation),
    switchRow('lite', 'Lite graphics', 'Lighter drawing for slower devices.', deps.lite, h('p', { class: 'st-note st-reload' }, 'Full effect after reload')),
  ];
  const preferences = h('ul', { class: 'st-list', role: 'list', 'aria-label': 'Preferences' }, ...switches.map((s) => s.el));

  host.replaceChildren(h('section', { class: 'pg' },
    h('header', { class: 'pg-head' }, h('div', { class: 'pg-head-text' }, pageTitle('Settings'), h('p', { class: 'pg-sub' }, 'Demo mode: nothing here reaches a real account yet.'))),
    section('Preferences', undefined, preferences),
    section('Timetables', 'Pause an agent to block Run now (real timetables pause from stage 3), or run it once now.', message, timetableScroll),
    section('Brand & rules', 'What Sentinel checks on every draft before it reaches you. Read-only.', rules),
    section('Approval modes', undefined, modes),
    section('Connections', 'The outside services the team will use. None is connected in this demo.', connections, h('p', { class: 'st-note' }, h('a', { class: 'ob-edit', href: '#/welcome' }, 'Set up connections'), ' walks through them one at a time.')),
  ));

  // Keep the page honest while the demo day runs, and when the command bar changed a switch.
  const refresh = (): void => {
    for (const s of switches) s.sync();
    for (const s of rowSyncs) s();
  };
  const unsubscribe = store.subscribe(() => {
    try {
      refresh();
    } catch (err) {
      console.warn('[hq] settings could not update', err);
    }
  });
  return unsubscribe;
}
