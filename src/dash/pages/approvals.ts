// Approvals: every draft waiting for a decision, newest first, with Approve / Edit / Reject. Edit opens an inline editor
// (an 'editor' layer, so Esc outside the text box closes it); Save keeps the draft waiting. The editor never survives
// the draft it was opened for: if the store resets (the demo day restarts) or the draft is decided, it closes unsaved,
// and whatever was typed stays on the page, read-only, with a Copy button until dismissed. While an editor is open its
// card cannot be approved or rejected (Save or Cancel first), and the demo script's own decisions for it wait.
import { isPlanDraft } from '../actions';
import { h } from '../dom';
import type { HFn } from '../dom';
import { lostEdit, setEditingId } from '../editing';
import { focusAfterRebuild } from '../focus';
import type { FocusKind } from '../focus';
import { takePendingEdit } from '../island';
import { flip, reducedMotion } from '../motion';
import { approvalRows } from '../rows';
import type { ApprovalRow } from '../rows';
import type { DashStore } from '../store';
import { chip, pageTitle, safely } from './common';
import type { PageDeps } from './common';

export interface CardHandlers {
  onApprove(): void;
  onEdit(): void;
  onReject(): void;
}

/** What identifies the draft an editor was opened for. `at` and `runId` tell it from a same-id draft of another day. */
export interface EditSnapshot {
  id: string;
  at: number;
  runId: string;
}

/** Whether the draft the editor was opened for is still waiting, unchanged. */
export function editorValid(store: DashStore, snap: EditSnapshot): boolean {
  const d = store.draft(snap.id);
  return d !== undefined && d.status === 'waiting' && d.at === snap.at && d.runId === snap.runId;
}

/** Saves `text` into the draft unless it is no longer the one the editor was opened for. The draft keeps waiting. */
export function saveEdit(store: DashStore, snap: EditSnapshot, text: string): boolean {
  return editorValid(store, snap) && store.editBody(snap.id, text);
}

/**
 * One waiting draft. `editor`, when given, takes the place of the draft text, and the card is in edit mode: Approve and
 * Reject are disabled (approving the stored original would silently drop what was typed) and Edit, which then only
 * returns to the open text box, is marked disabled but stays reachable.
 */
export function approvalCard(row: ApprovalRow, on: CardHandlers, hf: HFn = h, editor?: Node): HTMLElement {
  const editingNow = editor !== undefined;
  const approve = hf('button', { type: 'button', class: 'pg-btn pg-btn-gold', 'aria-label': `Approve: ${row.summary}`, ...(editingNow && { disabled: '' }) }, 'Approve');
  const edit = hf('button', { type: 'button', class: 'pg-btn pg-edit', 'aria-label': `Edit: ${row.summary}`, ...(editingNow && { 'aria-disabled': 'true' }) }, 'Edit');
  const reject = hf('button', { type: 'button', class: 'pg-btn pg-btn-danger', 'aria-label': `Reject: ${row.summary}`, ...(editingNow && { disabled: '' }) }, 'Reject');
  approve.addEventListener('click', safely('approve', on.onApprove));
  edit.addEventListener('click', safely('edit', on.onEdit));
  reject.addEventListener('click', safely('reject', on.onReject));

  const body =
    editor ??
    hf('div', { class: 'pg-body', tabindex: '0', role: 'region', 'aria-label': `Draft text: ${row.summary}` }, row.body);

  return hf(
    'li',
    { class: 'pg-card', 'data-id': row.id },
    hf('div', { class: 'pg-card-head' },
      hf('span', { class: 'pg-agent' }, row.agentName),
      chip(row.kindLabel, 'kind', hf),
      hf('span', { class: 'pg-time' }, row.time),
    ),
    hf('h2', { class: 'pg-card-title bz-display' }, row.summary),
    hf('p', { class: 'pg-sentinel' }, chip(row.sentinel, row.sentinel.startsWith('Passed') ? 'ok' : 'warn', hf)),
    body,
    hf('div', { class: 'pg-actions' }, approve, edit, reject),
  );
}

/** The controls of a card (or the editor in it) that a rebuild can hand focus back to. */
const KIND_SELECTOR: Record<Exclude<FocusKind, 'next' | 'copy'>, string> = {
  approve: '.pg-btn-gold',
  edit: '.pg-edit',
  reject: '.pg-btn-danger',
  body: '.pg-body',
  area: '.pg-textarea',
};

const LOST_NOTICE = 'This draft was decided elsewhere; your edit was not saved';

export function renderApprovals(host: HTMLElement, deps: PageDeps): () => void {
  const { store, actions, layers } = deps;

  const title = pageTitle('Approvals');
  const count = h('p', { class: 'pg-sub', role: 'status', 'aria-live': 'polite' });
  // Says (politely) when an open editor was closed under the person; its own region so the count does not talk over it.
  const notice = h('p', { class: 'pg-sub', role: 'status', 'aria-live': 'polite' });
  const approvePlan = h('button', { type: 'button', class: 'pg-btn pg-btn-gold pg-plan' }, 'Approve all plan');
  approvePlan.hidden = true;
  approvePlan.addEventListener('click', safely('approve all plan', () => void actions.approveAll(isPlanDraft, 'plan')));
  const head = h('header', { class: 'pg-head' }, h('div', { class: 'pg-head-text' }, title, count, notice), approvePlan);
  const lostList = h('ul', { class: 'pg-list', role: 'list', 'aria-label': 'Edits that were not saved' });
  lostList.hidden = true;
  const list = h('ul', { class: 'pg-list', role: 'list', 'aria-label': 'Drafts waiting for approval' });
  const empty = h('p', { class: 'pg-empty' }, 'Nothing is waiting for you. New drafts appear here as the team finishes them.');
  host.replaceChildren(h('section', { class: 'pg' }, head, lostList, list, empty));

  /** The open editor: its draft, its (persistent) text box and the layer registration. */
  let editing: { snap: EditSnapshot; area: HTMLTextAreaElement; node: HTMLElement; dropLayer: () => void; original: string; summary: string } | undefined;
  const cards = new Map<string, { li: HTMLElement; sig: string }>();
  let alive = true;

  /** Text typed into an editor that was closed under the person, kept readable (and copyable) until they dismiss it. */
  function keepLost(summary: string, text: string): void {
    const area = h('textarea', { class: 'pg-textarea', readonly: '', rows: '8', 'aria-label': `Your unsaved text: ${summary}` }) as HTMLTextAreaElement;
    area.value = text;
    const copy = h('button', { type: 'button', class: 'pg-btn pg-btn-gold' }, 'Copy');
    const dismiss = h('button', { type: 'button', class: 'pg-btn' }, 'Dismiss');
    const li = h('li', { class: 'pg-card pg-lost' },
      h('p', { class: 'pg-agent' }, 'Not saved'),
      h('h2', { class: 'pg-card-title bz-display' }, summary),
      area,
      h('div', { class: 'pg-actions' }, copy, dismiss),
    );
    copy.addEventListener('click', safely('copy unsaved text', () => {
      const done = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'));
      done.then(
        () => { notice.textContent = 'Copied.'; },
        () => {
          area.focus({ preventScroll: true });
          area.select();
          notice.textContent = 'Select the text and copy it with Ctrl or Command C.';
        },
      );
    }));
    dismiss.addEventListener('click', safely('dismiss unsaved text', () => {
      li.remove();
      lostList.hidden = lostList.children.length === 0;
      title.focus({ preventScroll: true });
    }));
    lostList.append(li);
    lostList.hidden = false;
  }

  /** Closes the editor for good; the person's typing is kept if it differs from what the draft held. */
  function dropEditor(keep: boolean): void {
    if (!editing) return;
    const { dropLayer, area, original, summary } = editing;
    editing = undefined;
    dropLayer();
    if (keep && lostEdit(original, area.value)) {
      keepLost(summary, area.value);
      notice.textContent = LOST_NOTICE;
    }
  }

  const closeEditor = (): void => {
    if (!editing) return;
    const id = editing.snap.id;
    dropEditor(false);
    sync();
    list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .pg-edit`)?.focus({ preventScroll: true });
    setEditingId(undefined); // lets the script's held decisions through
  };

  function openEditor(row: ApprovalRow): void {
    if (editing) {
      // Edit on the card already being edited, or with typing that would be lost: back to the open text box.
      if (editing.snap.id === row.id || lostEdit(editing.original, editing.area.value)) {
        editing.area.focus({ preventScroll: true });
        return;
      }
      dropEditor(false);
    }
    notice.textContent = '';
    const area = h('textarea', { class: 'pg-textarea', id: `pg-edit-${row.id}`, rows: '10' }) as HTMLTextAreaElement;
    area.value = row.body;
    const cancel = h('button', { type: 'button', class: 'pg-btn' }, 'Cancel');
    const save = h('button', { type: 'button', class: 'pg-btn pg-btn-gold' }, 'Save');
    const node = h('div', { class: 'pg-editor', role: 'group', 'aria-label': `Edit draft: ${row.summary}` },
      h('label', { class: 'pg-label', for: area.id }, 'Draft text'),
      area,
      h('div', { class: 'pg-actions' }, save, cancel),
    );
    const snap: EditSnapshot = { id: row.id, at: row.at, runId: store.draft(row.id)?.runId ?? '' };
    const dropLayer = layers.push('editor', closeEditor);
    editing = { snap, area, node, dropLayer, original: row.body, summary: row.summary };
    setEditingId(row.id); // the demo script's decisions for this draft wait until the editor closes
    cancel.addEventListener('click', safely('cancel edit', closeEditor));
    save.addEventListener('click', safely('save edit', () => {
      const e = editing;
      if (!e) return;
      editing = undefined;
      e.dropLayer();
      saveEdit(store, e.snap, e.area.value); // notifies: the card shows the new text and keeps waiting
      sync();
      list.querySelector<HTMLElement>(`[data-id="${CSS.escape(e.snap.id)}"] .pg-edit`)?.focus({ preventScroll: true });
      setEditingId(undefined);
    }));
    sync();
    area.focus({ preventScroll: true });
    list.querySelector(`[data-id="${CSS.escape(row.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function cardFor(row: ApprovalRow): HTMLElement {
    const mine = editing?.snap.id === row.id;
    return approvalCard(
      row,
      {
        onApprove: () => { if (!mine) void actions.approve(row.id, row.plan ? 'plan' : 'item'); },
        onEdit: () => openEditor(row),
        onReject: () => { if (!mine) void actions.reject(row.id); },
      },
      h,
      mine ? editing?.node : undefined,
    );
  }

  /** Which control inside the list has focus, and the draft it belongs to. */
  function focusedControl(): { kind: FocusKind | undefined; id: string | undefined } | undefined {
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || !list.contains(a)) return undefined;
    const id = a.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (a.closest('.pg-editor')) return { kind: 'area', id };
    for (const [kind, sel] of Object.entries(KIND_SELECTOR)) if (a.matches(sel)) return { kind: kind as FocusKind, id };
    return { kind: undefined, id };
  }

  function sync(): void {
    if (!alive) return;
    let released = false;
    if (editing && !editorValid(store, editing.snap)) {
      // Decided, or the demo day restarted: close without saving and without emitting anything. What was typed is kept.
      dropEditor(true);
      released = true;
    }
    const rows = approvalRows(store);
    const before = focusedControl();
    const beforeIds = [...list.children].map((c) => (c as HTMLElement).dataset.id).join('|');
    const after = rows.map((r) => r.id).join('|');

    const apply = (): void => {
      const wanted = new Set(rows.map((r) => r.id));
      for (const [id, c] of cards) {
        if (!wanted.has(id)) {
          c.li.remove();
          cards.delete(id);
        }
      }
      rows.forEach((row, i) => {
        const sig = JSON.stringify([row.summary, row.body, row.sentinel, row.agent, row.kind, row.time, editing?.snap.id === row.id]);
        let c = cards.get(row.id);
        if (!c || c.sig !== sig) {
          const li = cardFor(row);
          if (c) c.li.replaceWith(li);
          c = { li, sig };
          cards.set(row.id, c);
        }
        if (list.children[i] !== c.li) list.insertBefore(c.li, list.children[i] ?? null);
      });
    };
    if (beforeIds !== after) flip(list, apply);
    else apply();

    const n = rows.length;
    count.textContent = n === 0 ? 'Nothing waiting' : `${n} waiting for you`;
    empty.hidden = n > 0;
    list.hidden = n === 0;
    approvePlan.hidden = !rows.some((r) => r.plan);
    if (before && !list.contains(document.activeElement)) {
      // Focus was on a card that changed or went: back to the same kind of control on the same draft if it is still
      // there, else the page heading. Never to an Approve button, which could be a different draft's.
      const li = before.id !== undefined ? list.querySelector<HTMLElement>(`[data-id="${CSS.escape(before.id)}"]`) : null;
      const available = li
        ? (Object.keys(KIND_SELECTOR) as (keyof typeof KIND_SELECTOR)[]).filter((k) => {
            const node = li.querySelector<HTMLButtonElement>(KIND_SELECTOR[k]);
            return node !== null && !node.disabled;
          })
        : [];
      const target = before.kind ? focusAfterRebuild({ kind: before.kind, id: before.id }, { id: li ? before.id : undefined, available }) : 'heading';
      const node = target === 'heading' || !(target in KIND_SELECTOR) ? title : li?.querySelector<HTMLElement>(KIND_SELECTOR[target as keyof typeof KIND_SELECTOR]) ?? title;
      node.focus({ preventScroll: true });
    }
    if (released) setEditingId(undefined);
  }

  const unsubscribe = store.subscribe(() => {
    try {
      sync();
    } catch (err) {
      console.warn('[hq] approvals could not update', err);
    }
  });

  sync();
  // The island's Edit button: open that draft's editor straight away.
  const wanted = takePendingEdit();
  const row = wanted === undefined ? undefined : approvalRows(store).find((r) => r.id === wanted);
  if (row) openEditor(row);

  return () => {
    alive = false;
    unsubscribe();
    editing?.dropLayer();
    editing = undefined;
    setEditingId(undefined);
  };
}
