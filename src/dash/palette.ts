// The ⌘K / Ctrl K command bar: jump to a page, run an agent, approve the plan, flip a setting, or say it out loud.
// buildCommands / rankCommands / parseUtterance are pure; createPalette is the glass dialog around them. The palette is
// a 'palette' layer: Esc is handled once, globally (main.ts), so it adds no Esc listener of its own.
// Glass rule: the panel is one .glass with its own blur; the dim scrim is a sibling; only the panel's transform animates.
import type { Agent, AgentId } from '../types';
import { ROSTER } from '../roster';
import { createMic } from './dictation';
import type { Layers } from './layers';
import { ease, reducedMotion } from './motion';
import { NAV } from './shell';
import type { PageId } from './shell';

export type Run =
  | { kind: 'page'; page: PageId; filter?: string }
  | { kind: 'run'; agent: AgentId }
  | { kind: 'approve-plan' }
  | { kind: 'toggle'; what: 'sound' | 'lite' | 'dictation' };

export interface Command {
  id: string;
  title: string;
  hint: string;
  run: Run;
}

/** Studio agents make posts and plans (the Content page); everyone else's trail is in Activity. */
const showRun = (a: Pick<Agent, 'id' | 'zone'>): Run => ({
  kind: 'page',
  page: a.zone === 'studio' ? 'content' : 'activity',
  filter: a.id,
});

export function buildCommands(roster: readonly Agent[]): Command[] {
  const working = roster.filter((a) => !a.parked);
  return [
    { id: 'waiting', title: "What's waiting?", hint: 'Drafts waiting for a decision', run: { kind: 'page', page: 'approvals' } },
    { id: 'approve-plan', title: 'Approve all plan', hint: 'Approve every waiting content plan at once', run: { kind: 'approve-plan' } },
    ...NAV.map((n): Command => ({
      id: `page:${n.id}`,
      title: n.label,
      hint: n.id === 'home' ? 'Back to the office' : `Open the ${n.label} page`,
      run: { kind: 'page', page: n.id },
    })),
    { id: 'setup', title: 'Set up connections', hint: 'Open the welcome wizard for email, social networks and website', run: { kind: 'page', page: 'welcome' } },
    ...working.map((a): Command => ({ id: `run:${a.id}`, title: `Run ${a.name}`, hint: a.role, run: { kind: 'run', agent: a.id } })),
    ...working.map((a): Command => ({
      id: `show:${a.id}`,
      title: `Show ${a.name}'s work`,
      hint: a.zone === 'studio' ? 'Posts and plans in Content' : 'Their trail in Activity',
      run: showRun(a),
    })),
    { id: 'toggle:sound', title: 'Sound on or off', hint: 'Soft cues for new work and sent mail', run: { kind: 'toggle', what: 'sound' } },
    { id: 'toggle:lite', title: 'Lighter graphics on or off', hint: 'For slower computers', run: { kind: 'toggle', what: 'lite' } },
    { id: 'toggle:dictation', title: 'Dictation on or off', hint: 'Speak a command with the mic (off by default)', run: { kind: 'toggle', what: 'dictation' } },
  ];
}

/**
 * Commands whose title or hint cover every word typed. Title prefix first, then a title word starting with the first
 * word typed, then anywhere in the title, then hint-only matches; ties keep the order given.
 */
export function rankCommands<T extends { title: string; hint: string }>(cmds: readonly T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return cmds.slice(0, limit);
  const words = q.split(/\s+/);
  const scored: { c: T; score: number }[] = [];
  for (const c of cmds) {
    const title = c.title.toLowerCase();
    const hay = `${title} ${c.hint.toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const score = title.startsWith(q) ? 3
      : title.split(/[^a-z0-9]+/).some((w) => w.startsWith(words[0])) ? 2
      : title.includes(words[0]) ? 1
      : 0;
    scored.push({ c, score });
  }
  // Array.prototype.sort is stable, so equal scores keep their original order.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.c);
}

const AGENT_IDS: ReadonlyMap<string, Agent> = new Map(ROSTER.map((a) => [a.id as string, a]));

/** Lower case, "muse's" -> "muse", punctuation gone, one space between words. */
const norm = (s: string): string =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/'s\b/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** What a dictated (or typed) sentence means, or undefined when it is not one of the phrases the bar understands. */
export function parseUtterance(text: string): Run | undefined {
  const t = norm(text);
  if (/^approve all (?:the )?plans?$/.test(t)) return { kind: 'approve-plan' };
  if (/^(?:what|whats) (?:is )?waiting(?: for me)?$/.test(t)) return { kind: 'page', page: 'approvals' };
  const run = /^run ([a-z]+)$/.exec(t);
  if (run) {
    const a = AGENT_IDS.get(run[1]);
    return a ? { kind: 'run', agent: a.id } : undefined;
  }
  const show = /^show ([a-z]+)(?: (?:work|posts?|content|activity|drafts?))?$/.exec(t);
  if (show) {
    const a = AGENT_IDS.get(show[1]);
    return a ? showRun(a) : undefined;
  }
  return undefined;
}

/**
 * What happens to the words the mic hears. Nothing at all unless the bar is open and dictation is still on, so a late
 * result after switching it off (or closing the bar) fills nothing and runs nothing. A final transcript that parses
 * runs its command; one that does not leaves the text in the input with a hint.
 */
export function dictationHandler(h: {
  isOpen(): boolean;
  dictationOn(): boolean;
  fill(text: string): void;
  execute(r: Run): void;
  say(message: string): void;
}): (text: string, final: boolean) => void {
  return (text, final) => {
    if (!h.isOpen() || !h.dictationOn()) return;
    h.fill(text);
    if (!final || text === '') return;
    const r = parseUtterance(text);
    if (r) h.execute(r);
    else h.say(`Heard "${text}". Try "run scout", or pick from the list.`);
  };
}

// ---------------------------------------------------------------------------------------------------------- the dialog

export interface PaletteDeps {
  /** Does the command. A returned message is shown in the bar, which then stays open; otherwise the bar closes. */
  run: (r: Run) => string | void;
  layers: Layers;
  /** Whether dictation is switched on (a preference; off by default). */
  dictation: () => boolean;
}

export interface Palette {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const NS = 'http://www.w3.org/2000/svg';
const LIST_ID = 'bz-pal-list';
const POPIA = 'Speech is sent to Google for recognition (POPIA).';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function searchIcon(): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'bz-pal-icon');
  const circle = document.createElementNS(NS, 'circle');
  circle.setAttribute('cx', '11');
  circle.setAttribute('cy', '11');
  circle.setAttribute('r', '7');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M20 20l-4-4');
  svg.append(circle, path);
  return svg;
}

export function createPalette(root: HTMLElement, deps: PaletteDeps): Palette {
  const commands = buildCommands(ROSTER);

  const wrap = el('div', 'bz-pal');
  wrap.hidden = true;
  const scrim = el('div', 'bz-pal-scrim');
  const panel = el('div', 'bz-pal-panel glass');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Command bar');

  const row = el('div', 'bz-pal-row');
  const input = el('input', 'bz-pal-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Search, or try "run scout"';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', 'Search pages and commands');
  input.setAttribute('aria-controls', LIST_ID);
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-autocomplete', 'list');
  row.append(searchIcon(), input);

  const list = el('ul', 'bz-pal-list');
  list.id = LIST_ID;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Commands');
  const empty = el('p', 'bz-pal-empty', 'Nothing matches. Try "run scout" or "what\'s waiting".');
  empty.hidden = true;
  const msg = el('p', 'bz-pal-msg');
  msg.setAttribute('role', 'status');
  msg.hidden = true;

  const dict = el('div', 'bz-pal-dict');
  const dictNote = el('span', 'bz-pal-dict-note');
  const dictOff = el('button', 'bz-pal-dict-off', 'Turn dictation off');
  dictOff.type = 'button';
  dict.append(dictNote, dictOff);
  dict.hidden = true;

  const foot = el('div', 'bz-pal-foot');
  for (const t of ['↑↓ move', '↵ run', 'esc close']) foot.append(el('span', undefined, t));

  panel.append(row, list, empty, msg, dict, foot);
  wrap.append(scrim, panel);
  root.append(wrap);

  let isOpen = false;
  let shown: Command[] = [];
  let sel = 0;
  let drop: (() => void) | null = null;
  let previous: HTMLElement | null = null;

  const dictationOn = (): boolean => {
    try {
      return deps.dictation();
    } catch {
      return false;
    }
  };

  function showMessage(text: string): void {
    msg.textContent = text;
    msg.hidden = text === '';
  }

  /** Runs a command. A message back means "stay and show it"; otherwise the bar closes. Never throws. */
  function execute(r: Run): void {
    let message: string | void;
    try {
      message = deps.run(r);
    } catch (err) {
      console.warn('[hq] command failed', r, err);
      message = 'That did not work. Please try again.';
    }
    if (typeof message === 'string' && message !== '') {
      showMessage(message);
      refreshDictation();
      input.focus({ preventScroll: true });
    } else {
      close();
    }
  }

  // ---- dictation: the mic and the note appear only while it is on (off by default), with a visible off switch.
  const mic = createMic({
    onText: dictationHandler({
      isOpen: () => isOpen,
      dictationOn,
      fill(text) {
        input.value = text;
        sel = 0;
        draw();
      },
      execute,
      say: showMessage,
    }),
    onError: showMessage,
  });
  if (mic) row.append(mic);

  function refreshDictation(): void {
    const on = dictationOn();
    if (!on) mic?.stopListening(); // switching it off ends the recording at once, not just the button
    if (mic) mic.hidden = !on;
    dict.hidden = !on;
    dictNote.textContent = on ? (mic ? `Dictation is on. ${POPIA}` : 'Dictation is on, but this browser cannot listen.') : '';
  }
  dictOff.addEventListener('click', () => execute({ kind: 'toggle', what: 'dictation' }));

  // ---- the list
  function draw(): void {
    shown = rankCommands(commands, input.value);
    sel = shown.length ? Math.min(sel, shown.length - 1) : 0;
    const items = shown.map((c, i) => {
      const li = el('li', 'bz-pal-item');
      li.id = `bz-pal-opt-${i}`;
      li.dataset.i = String(i);
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === sel));
      li.append(el('span', 'bz-pal-title', c.title), el('span', 'bz-pal-hint', c.hint));
      return li;
    });
    list.replaceChildren(...items);
    empty.hidden = shown.length > 0;
    if (shown.length) input.setAttribute('aria-activedescendant', `bz-pal-opt-${sel}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function select(i: number): void {
    if (!shown.length) return;
    sel = (i + shown.length) % shown.length;
    list.querySelectorAll('li').forEach((li, k) => li.setAttribute('aria-selected', String(k === sel)));
    input.setAttribute('aria-activedescendant', `bz-pal-opt-${sel}`);
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => {
    sel = 0;
    showMessage('');
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const c = shown[sel];
      if (c) execute(c.run);
    }
  });
  list.addEventListener('pointermove', (e) => {
    const li = (e.target as Element).closest('li');
    if (li && Number(li.dataset.i) !== sel) select(Number(li.dataset.i));
  });
  list.addEventListener('click', (e) => {
    const li = (e.target as Element).closest('li');
    const c = li ? shown[Number(li.dataset.i)] : undefined;
    if (c) execute(c.run);
  });
  scrim.addEventListener('pointerdown', () => close());

  // Keep Tab inside the dialog: the input, the mic and the off switch.
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const stops = ([input, mic, dictOff] as (HTMLElement | null)[]).filter((n): n is HTMLElement => !!n && !n.hidden && !n.closest('[hidden]'));
    const i = stops.indexOf(document.activeElement as HTMLElement);
    const next = stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  });

  // ---- open / close
  function open(): void {
    if (isOpen) return;
    isOpen = true;
    previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.value = '';
    sel = 0;
    showMessage('');
    refreshDictation();
    draw();
    wrap.hidden = false;
    drop = deps.layers.push('palette', close);
    input.focus({ preventScroll: true });
    if (!reducedMotion()) {
      const { easing, ms } = ease('bounce');
      panel.animate([{ transform: 'translateY(-10px) scale(0.97)' }, { transform: 'none' }], { duration: ms, easing });
    }
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    drop?.(); // when Layers closed us it has already unregistered; this is then a no-op
    drop = null;
    mic?.stopListening();
    wrap.hidden = true;
    if (previous?.isConnected) previous.focus({ preventScroll: true });
    previous = null;
  }

  // ⌘K / Ctrl K from anywhere, including inside a field.
  addEventListener('keydown', (e) => {
    try {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      if (isOpen) close();
      else open();
    } catch (err) {
      console.warn('[hq] command bar shortcut failed', err);
    }
  }, true);

  return { open, close, isOpen: () => isOpen };
}
