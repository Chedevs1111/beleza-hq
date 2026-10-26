// The agent card: a glass panel (aubergine and gold) that opens when a person is clicked.
// One element is reused; content is set with textContent only. Esc and the close button close it.
import './style.css';
import type { Agent, ZoneId } from '../types';

export interface AgentCardInfo {
  /** What they are doing today, in a short line. */
  task?: string;
  /** e.g. "Today 07:30, 22 s". */
  lastRun?: string;
  /** e.g. "Tomorrow 07:30". */
  nextRun?: string;
  /** Spend so far today, in US dollars. */
  costToday?: number;
  /** "Run now" in demo mode: starts a demo run and says whether it did (false: already on a run, paused or parked). */
  onRun?: () => boolean;
  /** Why a refused "Run now" did nothing (parked, paused, already working), in the words Settings uses. */
  refusal?: () => string;
}

const ZONE_LABEL: Record<ZoneId, string> = {
  growth: 'Growth floor',
  studio: 'The Studio',
  ops: 'Ops corner',
  client: 'Client desk',
};

const RUN_HINT = 'Demo run — live in stage 3';
const NONE = '–'; // en dash for "nothing yet"
const HINT_ID = 'hq-card-run-hint';

let card: HTMLElement | null = null;
let previousFocus: Element | null = null;
/** Pixels from the right edge when docked beside the live office column; null leaves the stylesheet's own spot. */
let dockPx: number | null = null;
const closeListeners = new Set<() => void>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(label: string, value: string): HTMLElement[] {
  return [el('dt', undefined, label), el('dd', undefined, value)];
}

const money = (n: number) => `$${n.toFixed(2)}`;

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    close(true);
  }
}

function close(notify: boolean): void {
  if (!card || card.hidden) return;
  card.hidden = true;
  window.removeEventListener('keydown', onKey);
  const back = previousFocus;
  previousFocus = null;
  if (back instanceof HTMLElement && document.contains(back)) back.focus({ preventScroll: true });
  if (notify) for (const cb of [...closeListeners]) cb();
}

function ensureCard(): HTMLElement {
  if (card) return card;
  card = el('aside', 'hq-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'false');
  card.hidden = true;
  if (dockPx !== null) card.style.right = `${dockPx}px`;
  document.body.append(card);
  return card;
}

/** Moves the card's right edge so it sits just left of the live office column (or back, with null). */
export function setAgentCardDock(px: number | null): void {
  dockPx = px !== null && Number.isFinite(px) && px > 0 ? Math.round(px) : null;
  if (card) card.style.right = dockPx === null ? '' : `${dockPx}px`;
}

/** Opens (or refreshes) the card for `agent`. Focus moves to its close button; Esc closes it. */
export function showAgentCard(agent: Agent, info: AgentCardInfo = {}): void {
  const root = ensureCard();
  if (root.hidden) previousFocus = document.activeElement;
  root.setAttribute('aria-label', `${agent.name}, ${agent.role}`);
  root.dataset.zone = agent.zone;
  root.dataset.agent = agent.id;

  const avatar = el('span', 'hq-card-avatar', agent.name[0]);
  avatar.setAttribute('aria-hidden', 'true');
  const titles = el('div', 'hq-card-titles');
  titles.append(el('h2', 'hq-card-name', agent.name), el('p', 'hq-card-role', agent.role));
  const closeBtn = el('button', 'hq-card-close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', `Close ${agent.name}'s card`);
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => close(true));
  const header = el('header', 'hq-card-head');
  header.append(avatar, titles, closeBtn);

  const chips = el('p', 'hq-card-chips');
  chips.append(el('span', 'hq-chip', ZONE_LABEL[agent.zone]));
  if (agent.parked) chips.append(el('span', 'hq-chip hq-chip-parked', 'Parked'));

  const task = agent.parked ? `Parked: ${agent.parkedReason ?? 'waiting'}` : info.task ?? NONE;
  const facts = el('dl', 'hq-card-facts');
  facts.append(
    ...row("Today's task", task),
    ...row('Last run', info.lastRun ?? NONE),
    ...row('Next run', info.nextRun ?? NONE),
    ...row('Spend today', info.costToday === undefined ? NONE : money(info.costToday)),
  );

  // Live in the demo when the caller gives onRun (and the agent is not parked); otherwise a disabled button with a
  // visible hint it points to: screen readers read "Run now, dimmed, Demo run — live in stage 3".
  const onRun = agent.parked ? undefined : info.onRun;
  const run = el('button', 'hq-card-run', 'Run now');
  run.type = 'button';
  run.disabled = onRun === undefined;
  if (run.disabled) run.setAttribute('aria-disabled', 'true');
  run.setAttribute('aria-describedby', HINT_ID);
  run.title = RUN_HINT;
  const hint = el('span', 'hq-card-hint', RUN_HINT);
  hint.id = HINT_ID;
  hint.setAttribute('role', 'status');
  if (onRun) {
    run.addEventListener('click', () => {
      let started = false;
      try {
        started = onRun();
      } catch (err) {
        console.warn('[hq] could not start a demo run', err);
      }
      let why = 'Already on a run';
      try {
        why = info.refusal?.() ?? why;
      } catch (err) {
        console.warn('[hq] could not say why a demo run did not start', err);
      }
      hint.textContent = started ? 'Demo run started' : why;
    });
  }
  const actions = el('div', 'hq-card-actions');
  actions.title = RUN_HINT; // disabled buttons get no hover events; the wrapper carries the tooltip
  actions.append(run, hint);

  root.replaceChildren(header, chips, facts, actions);
  const opening = root.hidden;
  root.hidden = false;
  if (opening) window.addEventListener('keydown', onKey);
  closeBtn.focus({ preventScroll: true });
}

/** Closes the card without telling the close listeners. */
export function hideAgentCard(): void {
  close(false);
}

export function isAgentCardOpen(): boolean {
  return card !== null && !card.hidden;
}

/** Called when the user closes the card (close button or Esc). Returns an unsubscribe function. */
export function onAgentCardClose(cb: () => void): () => void {
  closeListeners.add(cb);
  return () => closeListeners.delete(cb);
}
