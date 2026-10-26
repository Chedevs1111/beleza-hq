// The live island (top centre): a small glass pill with the mascot that says what the team is doing right now. Click it
// (or press Enter / Space) and it opens a preview of the newest draft waiting for you, with Approve / Edit / Reject, so
// you can decide without leaving the office. Everything here is derived from the DashStore; the actions only emit events.
// Glass rule: the pill and the preview are two separate panels (siblings, one blur each), and only transforms animate.
import type { AgentEvent, DraftKind } from '../events';
import { ROSTER } from '../roster';
import type { AgentId } from '../types';
import type { DemoActions } from './actions';
import type { Layers } from './layers';
import { GREET_MS, mascotSvg, moodFor } from './mascot';
import type { MascotMood } from './mascot';
import { focusAfterRebuild } from './focus';
import type { FocusKind } from './focus';
import { ease, reducedMotion } from './motion';
import { AlertQueue, pillViews, runAlert } from './pills';
import type { PillAlert, PillView } from './pills';
import { pillsOrder } from './prefs';
import type { Cue, Sounds } from './sounds';
import type { DashStore, DraftRecord } from './store';

export interface IslandView {
  mood: MascotMood;
  line: string;
  sub: string;
  agent?: AgentId;
  draft?: DraftRecord;
  /** Drafts waiting for a decision, whatever the mood. */
  waiting: number;
}

/** How long (in demo hours; about 3 s of real time at 600 s per day) a fresh `sent` makes the mascot cheer. */
const CHEER_HOURS = 0.12;

const KIND_NOUN: Record<DraftKind, string> = {
  email: 'email',
  post: 'post',
  comment: 'comment',
  linkedin: 'LinkedIn note',
  proposal: 'proposal',
  plan: 'plan',
};

const nameOf = (a: AgentId): string => ROSTER.find((r) => r.id === a)?.name ?? a;

/** Demo hours from `at` to `hour`, wrapping at midnight (the demo day runs 06:00 round past 24:00). */
const hoursSince = (hour: number, at: number): number => (((hour - at) % 24) + 24) % 24;

const newest = (list: DraftRecord[]): DraftRecord | undefined =>
  list.reduce<DraftRecord | undefined>((best, d) => (!best || d.at >= best.at ? d : best), undefined);

/** The waiting draft changed most recently (the later one wins a tie), or undefined. */
export const newestWaiting = (store: DashStore): DraftRecord | undefined => newest(store.drafts({ status: 'waiting' }));

/** How a draft the island was showing has since been decided. */
export type DecidedStatus = 'approved' | 'rejected' | 'sent';

export interface PreviewTarget {
  draft?: DraftRecord;
  /** Set when `draft` is no longer waiting: the preview stays on it instead of moving to another. */
  decided?: DecidedStatus;
}

/**
 * The draft the open preview shows. The one the person opened stays put: while it waits, and after it is decided
 * (elsewhere, or by them here), so a button under the pointer never turns into a different draft's button. Only when it
 * is gone (the demo day restarted) or nothing was opened does the newest waiting draft take over.
 */
export function previewTarget(opened: string | undefined, store: DashStore): PreviewTarget {
  const kept = opened !== undefined ? store.draft(opened) : undefined;
  if (kept?.status === 'waiting') return { draft: kept };
  if (kept && (kept.status === 'approved' || kept.status === 'rejected' || kept.status === 'sent')) return { draft: kept, decided: kept.status };
  const next = newestWaiting(store);
  return next ? { draft: next } : {};
}

/** The line shown on a draft that is no longer waiting. `mine`: the person decided it from this preview. */
export function decidedNotice(status: DecidedStatus, mine: boolean): string {
  if (status === 'sent') return 'Sent';
  const word = status === 'approved' ? 'Approved' : 'Rejected';
  return mine ? word : `${word} elsewhere`;
}

/**
 * What the island says. A send in the last 0.12 demo hours (about 3 s of real time) first (cheer), then the newest waiting draft (envelope),
 * then an agent mid-run (bright, preferring one that has reported progress), else it dozes. `calm` is not chosen here:
 * the island shows it while it is open with nothing waiting.
 */
export function islandView(store: DashStore, hour: number): IslandView {
  const waiting = store.drafts({ status: 'waiting' });
  const base = { waiting: waiting.length };

  const justSent = newest(store.drafts({ status: 'sent' }).filter((d) => hoursSince(hour, d.at) <= CHEER_HOURS));
  if (justSent) {
    return {
      mood: 'cheer',
      line: `${nameOf(justSent.agent)}'s ${KIND_NOUN[justSent.kind]} sent`,
      sub: justSent.summary,
      agent: justSent.agent,
      draft: justSent,
      ...base,
    };
  }

  const top = newest(waiting);
  if (top) {
    return { mood: 'envelope', line: `${nameOf(top.agent)} · ${KIND_NOUN[top.kind]}`, sub: top.summary, agent: top.agent, draft: top, ...base };
  }

  const working = ROSTER.filter((a) => store.statusOf(a.id) === 'working');
  const withProgress = working.find((a) => store.progressOf(a.id) !== undefined);
  const who = withProgress ?? working[0];
  if (who) {
    const p = store.progressOf(who.id);
    if (!p) return { mood: 'bright', line: `${who.name} · starting`, sub: 'Getting started', agent: who.id, ...base };
    const counter = p.done !== undefined && p.total !== undefined ? `${p.done}/${p.total}` : p.text;
    return { mood: 'bright', line: `${who.name} · ${counter}`, sub: p.text, agent: who.id, ...base };
  }

  return { mood: 'doze', line: 'All quiet', sub: 'Nothing needs you right now', ...base };
}

/** The mood drawn: `calm` while the island is open with nothing waiting, unless a cheer is on (approving from it). */
export function shownMood(v: IslandView, open: boolean): MascotMood {
  return open && v.waiting === 0 && v.mood !== 'cheer' ? 'calm' : v.mood;
}

/** What happened between two looks at the store, as far as sound is concerned. */
export interface CueFacts {
  /** A draft started waiting for you. */
  freshDraft: boolean;
  /** Something was sent. */
  sent: boolean;
  /** A run ended without failing. */
  endedOk: boolean;
  /** A run failed. */
  failed: boolean;
  /** Something was approved. */
  approved: boolean;
  /** A run started. */
  started: boolean;
}

/** The cues that go with those facts. A run that ends with a new draft chimes `attention` only: `done` on top would be two chimes for one thing. */
export function cuesFor(f: CueFacts): Cue[] {
  const out: Cue[] = [];
  if (f.freshDraft) out.push('attention');
  else if (f.endedOk) out.push('done');
  if (f.sent) out.push('sent');
  if (f.approved) out.push('proud');
  if (f.started) out.push('think');
  if (f.failed) out.push('annoyed');
  return out;
}

/** How long a start, an approval and a failure show on the mascot (ms); a proud face hands over to the cheer when the send lands, 3 s later. */
const THINK_MS = 2000;
const PROUD_MS = 3000;
const ANNOYED_MS = 2500;
/** Pointer, keyboard and touch on this page are what count as someone being here. */
const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'] as const;
const IDLE_CHECK_MS = 5000;

// Task 7's editor reads this: the draft the island's Edit button asked for. Take-once, so a later visit starts clean.
let pendingEdit: string | undefined;
export function setPendingEdit(id: string | undefined): void {
  pendingEdit = id;
}
export function takePendingEdit(): string | undefined {
  const id = pendingEdit;
  pendingEdit = undefined;
  return id;
}

export interface IslandDeps {
  store: DashStore;
  actions: DemoActions;
  /** The demo hour of day (the same clock the store stamps drafts with). */
  hour(): number;
  /** Edit opens the draft in the Approvals editor. */
  onEdit(id: string): void;
  sounds: Sounds;
  layers: Layers;
  /** Milliseconds clock for the run-finished alerts (the tests inject one). */
  now?(): number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const PANEL_ID = 'bz-isl-panel';

export function createIsland(host: HTMLElement, deps: IslandDeps): void {
  const { store, actions, hour, onEdit, sounds, layers } = deps;
  const clock = deps.now ?? Date.now;
  const alerts = new AlertQueue(clock);

  const root = el('div', 'isl');
  const face = el('button', 'isl-face glass');
  face.type = 'button';
  face.setAttribute('aria-expanded', 'false');
  face.setAttribute('aria-controls', PANEL_ID);
  const mascot = el('span', 'isl-mascot');
  const text = el('span', 'isl-txt');
  const line = el('b', 'isl-line');
  const sub = el('span', 'isl-sub');
  const pillsEl = el('span', 'isl-pills');
  text.append(line, sub, pillsEl);
  const badge = el('i', 'isl-badge');
  badge.hidden = true;
  face.append(mascot, text, badge);

  const panel = el('section', 'isl-panel glass');
  panel.id = PANEL_ID;
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Draft waiting for your approval');

  // Announces a newly waiting draft and a failed run to screen readers; nothing else (the pill's own text changes too often to be a live region).
  const announce = el('span', 'isl-sr');
  announce.setAttribute('role', 'status');
  announce.setAttribute('aria-live', 'polite');

  root.append(face, panel, announce);
  host.append(root);

  let open = false;
  let shownId: string | undefined;
  /** Drafts decided with this preview's own buttons (their notice says "Approved", not "Approved elsewhere"). */
  const mine = new Set<string>();
  /** What the built panel shows and the pieces that change in place (counts), without a rebuild. */
  let built: { id?: string; decided: boolean; others?: HTMLElement; next?: HTMLButtonElement; heading?: HTMLElement } = { decided: false };
  let dropLayer: (() => void) | null = null;
  let faceKey = '';
  let panelKey = '';
  let mood: MascotMood | '' = '';
  let pillKey = '';
  let shownAlert: PillAlert | undefined;
  let alertTimer: ReturnType<typeof setTimeout> | undefined;
  // A passing mood (hello, thinking, proud, annoyed) laid over what the island would otherwise show, and the idle moods.
  let passing: { mood: MascotMood; until: number } | undefined;
  let passingTimer: ReturnType<typeof setTimeout> | undefined;
  let idleMood: MascotMood | undefined;
  let lastInput = clock();

  // ---- drawing

  /** The draft the open preview shows (see previewTarget). */
  const currentTarget = (): PreviewTarget => {
    const t = previewTarget(shownId, store);
    shownId = t.draft?.id;
    return t;
  };

  /** The waiting count under the preview, updated in place so the buttons are not rebuilt (and focus not moved) by it. */
  function syncCounts(waiting: number): void {
    const { others, next, decided } = built;
    if (!others) return;
    const n = decided ? waiting : Math.max(0, waiting - 1);
    others.textContent = decided ? `${n} waiting` : `${n} more waiting`;
    others.hidden = n === 0;
    if (next) {
      if (n === 0 && document.activeElement === next) built.heading?.focus({ preventScroll: true });
      next.hidden = n === 0;
    }
  }

  function buildPanel(t: PreviewTarget): void {
    const d = t.draft;
    if (!d) {
      const empty = el('p', 'isl-empty', 'Nothing is waiting for you.');
      empty.tabIndex = -1;
      panel.replaceChildren(empty, el('p', 'isl-empty-sub', "You'll hear a chime when something needs a decision."));
      built = { decided: false, heading: empty };
      return;
    }
    const decided = t.decided !== undefined;
    const head = el('div', 'isl-head');
    const who = el('span', 'isl-who', `${nameOf(d.agent)} · ${KIND_NOUN[d.kind]}`);
    const state = el('span', 'isl-state', t.decided ? decidedNotice(t.decided, mine.has(d.id)) : 'Waiting on you');
    head.append(who, state);

    const title = el('h3', 'isl-title bz-display', d.summary);
    title.tabIndex = -1;
    const body = el('div', 'isl-body', d.body);
    body.tabIndex = 0;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-label', 'Draft text');

    const approve = el('button', 'isl-btn isl-approve', 'Approve');
    const edit = el('button', 'isl-btn isl-edit', 'Edit');
    const reject = el('button', 'isl-btn isl-reject', 'Reject');
    for (const b of [approve, edit, reject]) {
      b.type = 'button';
      b.disabled = decided; // a draft that is already decided cannot be decided again
    }
    const act = (fn: () => void) => () => {
      try {
        fn();
      } catch (err) {
        console.warn('[hq] island action failed', err);
      }
    };
    // The preview stays on the draft it decided (with a notice) rather than jumping to the next one under the pointer.
    const decide = (run: () => boolean) => act(() => {
      mine.add(d.id);
      if (!run()) mine.delete(d.id);
    });
    approve.addEventListener('click', decide(() => actions.approve(d.id, d.kind === 'plan' ? 'plan' : 'item')));
    reject.addEventListener('click', decide(() => actions.reject(d.id)));
    edit.addEventListener('click', act(() => {
      setOpen(false);
      onEdit(d.id);
    }));
    const row = el('div', 'isl-actions');
    row.append(approve, edit, reject);

    const others = el('p', 'isl-others');
    const nodes: Node[] = [head, title, body, row];
    let next: HTMLButtonElement | undefined;
    if (decided) {
      next = el('button', 'isl-btn isl-next', 'Next waiting');
      next.type = 'button';
      next.addEventListener('click', act(() => {
        shownId = undefined; // the newest waiting draft takes over
        mine.clear();
        render();
        built.heading?.focus({ preventScroll: true });
      }));
      const nextRow = el('div', 'isl-actions');
      nextRow.append(next);
      nodes.push(nextRow);
    }
    nodes.push(others);
    panel.replaceChildren(...nodes);
    built = { id: d.id, decided, others, next, heading: title };
  }

  /** Which control inside the panel has focus, as a FocusKind. */
  function focusedKind(): FocusKind | undefined {
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || !panel.contains(a)) return undefined;
    if (a.classList.contains('isl-approve')) return 'approve';
    if (a.classList.contains('isl-edit')) return 'edit';
    if (a.classList.contains('isl-reject')) return 'reject';
    if (a.classList.contains('isl-next')) return 'next';
    if (a.classList.contains('isl-body')) return 'body';
    return undefined;
  }

  function chip(p: PillView): HTMLElement {
    const c = el('span', 'isl-pill');
    c.dataset.tone = p.tone;
    c.dataset.id = p.id;
    c.append(el('b', 'isl-pv', p.value), el('span', 'isl-pl', p.label));
    return c;
  }

  function alertChip(a: PillAlert): HTMLElement {
    const c = el('span', 'isl-pill isl-alert', a.text);
    c.dataset.tone = a.tone;
    return c;
  }

  /** The status pills; a finished-run alert takes their place for two seconds. Only the collapsed pill shows it: the open preview is never touched. */
  function renderPills(): void {
    const alert = alerts.current();
    const views = pillViews(store, hour(), pillsOrder());
    const k = JSON.stringify([alert, views]);
    if (k === pillKey) return;
    const newAlert = alert !== undefined && alert !== shownAlert;
    shownAlert = alert;
    pillKey = k;
    const nodes = alert ? [alertChip(alert)] : views.map(chip);
    pillsEl.replaceChildren(...nodes);
    pillsEl.hidden = nodes.length === 0;
    if (newAlert && nodes[0] && !reducedMotion()) {
      nodes[0].animate([{ transform: 'scale(0.86)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
    }
  }

  /** The mood drawn: a cheer always wins, then a passing mood, then yawn / sleep when nothing is going on. */
  function drawnMood(v: IslandView): MascotMood {
    const base = shownMood(v, open);
    if (base === 'cheer') return base;
    if (passing && clock() >= passing.until) passing = undefined;
    if (passing) return passing.mood;
    return idleMood && (base === 'doze' || base === 'calm') ? idleMood : base;
  }

  function showFor(m: MascotMood, ms: number): void {
    passing = { mood: m, until: clock() + ms };
    clearTimeout(passingTimer);
    passingTimer = setTimeout(() => {
      try {
        render();
      } catch (err) {
        console.warn('[hq] island could not update', err);
      }
    }, ms + 20);
  }

  function render(): void {
    const v = islandView(store, hour());
    const shown = drawnMood(v);

    const fk = JSON.stringify([shown, v.line, v.sub, v.waiting, open]);
    if (fk !== faceKey) {
      faceKey = fk;
      if (shown !== mood) {
        mascot.innerHTML = mascotSvg(shown); // static trusted markup
        mood = shown;
      }
      line.textContent = v.line;
      sub.textContent = v.sub;
      badge.textContent = String(v.waiting);
      badge.hidden = v.waiting === 0;
      badge.title = v.waiting === 1 ? '1 draft waiting for you' : `${v.waiting} drafts waiting for you`;
      face.setAttribute('aria-expanded', String(open));
      root.dataset.mood = shown;
      root.dataset.open = String(open);
    }

    renderPills();

    // The preview is rebuilt only when what it shows changes (not when the waiting count does: that text is updated in
    // place), so a button under the pointer is not swapped mid-click and focus is not moved by someone else's draft.
    const t: PreviewTarget = open ? currentTarget() : {};
    const d = t.draft;
    const pk = JSON.stringify([open, d && [d.id, d.summary, d.body, d.agent, d.kind, d.status], t.decided, d !== undefined && mine.has(d.id)]);
    if (pk !== panelKey) {
      panelKey = pk;
      const hadFocus = panel.contains(document.activeElement);
      const before = hadFocus ? { kind: focusedKind(), id: built.id } : undefined;
      panel.hidden = !open;
      if (open) buildPanel(t);
      else {
        panel.replaceChildren();
        built = { decided: false };
      }
      if (hadFocus) {
        if (!open) face.focus({ preventScroll: true });
        else {
          const available: FocusKind[] = ['body'];
          if (built.next) available.push('next');
          if (!built.decided && built.id !== undefined) available.push('edit', 'reject');
          const target = before?.kind ? focusAfterRebuild({ kind: before.kind, id: before.id }, { id: built.id, available }) : 'heading';
          const pick: Record<string, string> = { edit: '.isl-edit', reject: '.isl-reject', next: '.isl-next', body: '.isl-body' };
          const node = target === 'heading' ? built.heading : panel.querySelector<HTMLElement>(pick[target]);
          (node ?? panel.querySelector<HTMLElement>('button') ?? face).focus({ preventScroll: true });
        }
      }
    }
    if (open) syncCounts(v.waiting);
  }

  // ---- opening and closing

  const onOutside = (e: PointerEvent): void => {
    if (e.target instanceof Node && !root.contains(e.target)) setOpen(false);
  };

  function setOpen(on: boolean): void {
    if (on === open) return;
    open = on;
    if (on) {
      shownId = undefined;
      mine.clear();
      dropLayer = layers.push('island', () => setOpen(false));
      document.addEventListener('pointerdown', onOutside, true);
    } else {
      dropLayer?.();
      dropLayer = null;
      document.removeEventListener('pointerdown', onOutside, true);
    }
    render();
    if (on && !reducedMotion()) {
      const { easing, ms } = ease('bounce');
      // A drop-down under the pill on a wide window; a sheet rising from the bottom edge on a phone (island.css / phone.css).
      const from = innerWidth < 720 ? 'translateY(32px)' : 'translateY(-10px) scale(0.97)';
      panel.animate([{ transform: from }, { transform: 'none' }], { duration: ms, easing });
    }
  }

  face.addEventListener('click', () => {
    try {
      setOpen(!open);
    } catch (err) {
      console.warn('[hq] island toggle failed', err);
    }
  });
  addEventListener('hashchange', () => setOpen(false)); // the island is hidden off Home; do not leave it open behind

  // ---- cues and updates

  const waitingIds = (): Set<string> => new Set(store.drafts({ status: 'waiting' }).map((d) => d.id));
  const sentIds = (): Set<string> => new Set(store.drafts({ status: 'sent' }).map((d) => d.id));
  const approvedIds = (): Set<string> => new Set(store.drafts({ status: 'approved' }).map((d) => d.id));
  const runningAgents = (): Set<AgentId> => new Set(ROSTER.filter((a) => store.hasOpenRun(a.id)).map((a) => a.id));
  let prevWaiting = waitingIds();
  let prevSent = sentIds();
  let prevApproved = approvedIds();
  let prevRunning = runningAgents();
  let prevActivity = store.activity().length;

  /** Looks again when the showing alert runs out, and for the next queued one. */
  function tickAlerts(): void {
    clearTimeout(alertTimer);
    const ms = alerts.msLeft();
    if (ms <= 0) return;
    alertTimer = setTimeout(() => {
      try {
        render();
      } catch (err) {
        console.warn('[hq] island could not update', err);
      }
      tickAlerts();
    }, ms + 20);
  }

  /** Compares with the last look: a new waiting draft chimes, a run that ended well ticks, a send whoosh, and the mascot reacts. */
  function cues(): void {
    const activity = store.activity().length;
    const nowWaiting = waitingIds();
    const nowSent = sentIds();
    const nowApproved = approvedIds();
    const nowRunning = runningAgents();
    // A shorter log means the demo day restarted: nothing happened, so say nothing.
    if (activity >= prevActivity) {
      const fresh = [...nowWaiting].filter((id) => !prevWaiting.has(id));
      if (fresh.length > 0) {
        const d = store.draft(fresh[fresh.length - 1]);
        if (d) announce.textContent = `${nameOf(d.agent)}'s ${KIND_NOUN[d.kind]} is waiting for your approval`;
      }
      const ended = [...prevRunning].filter((a) => !nowRunning.has(a));
      const newRuns = [...nowRunning].filter((a) => !prevRunning.has(a));
      const newApproved = [...nowApproved].filter((id) => !prevApproved.has(id));
      const failedRuns = ended.filter((a) => store.statusOf(a) === 'failed');
      const facts: CueFacts = {
        freshDraft: fresh.length > 0,
        sent: [...nowSent].some((id) => !prevSent.has(id)),
        endedOk: ended.length > failedRuns.length,
        failed: failedRuns.length > 0,
        approved: newApproved.length > 0,
        started: newRuns.length > 0,
      };
      for (const cue of cuesFor(facts)) sounds.play(cue);
      // The mascot's mood for what just happened (the send's cheer comes from the island view, not from here).
      const feel = (event: AgentEvent, ms: number): void => showFor(moodFor({ kind: 'event', event }, mood || 'calm'), ms);
      if (newRuns[0]) feel({ type: 'run_started', runId: '', agent: newRuns[0], task: '' }, THINK_MS);
      if (newApproved[0]) feel({ type: 'approved', draftId: newApproved[0], mode: 'item' }, PROUD_MS);
      if (failedRuns[0]) feel({ type: 'run_finished', runId: '', agent: failedRuns[0], status: 'failed', costUsd: 0 }, ANNOYED_MS);
      for (const a of ended) {
        const alert = runAlert(nameOf(a), store.statusOf(a) === 'failed');
        alerts.push(alert);
        if (fresh.length === 0 && store.statusOf(a) === 'failed') announce.textContent = alert.text; // only a failure interrupts
      }
      if (ended.length > 0) tickAlerts();
      if (fresh.length > 0 && !reducedMotion()) {
        face.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
      }
    }
    prevWaiting = nowWaiting;
    prevSent = nowSent;
    prevApproved = nowApproved;
    prevRunning = nowRunning;
    prevActivity = activity;
  }

  store.subscribe(() => {
    try {
      cues();
    } catch (err) {
      console.warn('[hq] island cues failed', err);
    }
    try {
      render();
    } catch (err) {
      console.warn('[hq] island could not update', err);
    }
  });

  // ---- idle: no pointer, keyboard or touch on the page. 3 minutes yawns, 6 sleeps, any input wakes (the hello is for opening only).

  const setIdle = (minutes: number): void => {
    const m = moodFor({ kind: 'idle', minutes }, idleMood ?? 'calm');
    const next = m === 'yawn' || m === 'sleep' ? m : undefined;
    if (next === idleMood) return;
    const yawned = next === 'yawn';
    idleMood = next;
    if (yawned && !document.hidden) sounds.play('yawn');
    render();
  };
  const onInput = (): void => {
    lastInput = clock();
    if (!idleMood) return; // the common case: nothing to wake
    try {
      setIdle(0);
    } catch (err) {
      console.warn('[hq] island could not wake', err);
    }
  };
  for (const t of INPUTS) addEventListener(t, onInput, { capture: true, passive: true });
  setInterval(() => {
    try {
      setIdle((clock() - lastInput) / 60000);
    } catch (err) {
      console.warn('[hq] island idle check failed', err);
    }
  }, IDLE_CHECK_MS);

  // A cheer ends on the clock, not on an event: look again while one is showing.
  setInterval(() => {
    if (mood !== 'cheer' || document.hidden) return;
    try {
      render();
    } catch (err) {
      console.warn('[hq] island could not update', err);
    }
  }, 250);

  // "Next" moves with the clock, not with an event.
  setInterval(() => {
    if (document.hidden) return;
    try {
      renderPills();
    } catch (err) {
      console.warn('[hq] island could not update', err);
    }
  }, 5000);

  // Hello: the page just opened.
  showFor(moodFor({ kind: 'open' }, 'calm'), GREET_MS);
  try {
    sounds.play('greet');
  } catch (err) {
    console.warn('[hq] island could not greet', err);
  }
  render();
}
