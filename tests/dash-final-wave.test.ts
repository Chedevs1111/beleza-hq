// The final-wave fixes: the island keeps the draft it opened, focus never lands on Approve, scripted decisions wait
// for an open editor, and the small copy / accessibility rulings.
import { describe, it, expect } from 'vitest';
import { hIn } from '../src/dash/dom';
import type { HFn } from '../src/dash/dom';
import { decidedNotice, previewTarget } from '../src/dash/island';
import { focusAfterRebuild } from '../src/dash/focus';
import { ScriptHold, holdScriptedDecisions, lostEdit, setEditingId } from '../src/dash/editing';
import { approvalCard } from '../src/dash/pages/approvals';
import { agentFilter } from '../src/dash/pages/common';
import { switchRow } from '../src/dash/pages/settings';
import { isPlanDraft } from '../src/dash/actions';
import { PAUSE_NOTE } from '../src/dash/settings-data';
import { approvalRows } from '../src/dash/rows';
import { DashStore } from '../src/dash/store';
import type { AgentEvent, DraftKind } from '../src/events';
import type { AgentId } from '../src/types';

function waiting(store: DashStore, draftId: string, at: number, opts: { agent?: AgentId; kind?: DraftKind } = {}): void {
  const agent = opts.agent ?? 'quill';
  const runId = `${draftId}-run`;
  store.accept({ type: 'run_started', runId, agent, task: 'Seed' }, at - 0.3);
  store.accept({ type: 'draft_submitted', runId, agent, draftId, kind: opts.kind ?? 'email', summary: `Summary of ${draftId}` }, at - 0.2);
  store.accept({ type: 'sentinel_result', draftId, pass: true, reasons: [] }, at - 0.1);
  store.accept({ type: 'awaiting_approval', draftId, agent }, at);
}

// ---- a minimal fake document, as in the page tests
class FakeNode {
  tag?: string;
  data?: string;
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
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
  addEventListener(): void {}
}
const fakeDoc = {
  createElement: (tag: string) => new FakeNode({ tag }),
  createTextNode: (data: string) => new FakeNode({ data }),
} as unknown as Pick<Document, 'createElement' | 'createTextNode'>;
const fh: HFn = (tag, attrs, ...children) => hIn(fakeDoc, tag, attrs, ...children) as unknown as HTMLElement;
const walk = (n: FakeNode, out: FakeNode[] = []): FakeNode[] => {
  out.push(n);
  for (const c of n.children) walk(c, out);
  return out;
};
const all = (x: unknown): FakeNode[] => walk(x as FakeNode);
const textOf = (n: FakeNode): string => walk(n).map((c) => c.data ?? '').join('');

// ---------------------------------------------------------------- A1: the island keeps the draft it opened

describe('previewTarget', () => {
  it('shows the newest waiting draft when nothing was opened', () => {
    const s = new DashStore();
    waiting(s, 'a', 9);
    waiting(s, 'b', 10);
    expect(previewTarget(undefined, s).draft?.id).toBe('b');
    expect(previewTarget(undefined, s).decided).toBeUndefined();
  });

  it('keeps the opened draft while it waits, even when a newer one arrives', () => {
    const s = new DashStore();
    waiting(s, 'a', 9);
    waiting(s, 'b', 10);
    expect(previewTarget('a', s).draft?.id).toBe('a');
  });

  it('keeps a draft decided elsewhere, and says how', () => {
    const s = new DashStore();
    waiting(s, 'a', 9);
    waiting(s, 'b', 10);
    s.accept({ type: 'approved', draftId: 'a', mode: 'item' }, 10.1);
    expect(previewTarget('a', s)).toMatchObject({ decided: 'approved' });
    expect(previewTarget('a', s).draft?.id).toBe('a');
    s.accept({ type: 'sent', draftId: 'a', channel: 'email' }, 10.2);
    expect(previewTarget('a', s)).toMatchObject({ decided: 'sent' });
    s.accept({ type: 'rejected', draftId: 'b' }, 10.3);
    expect(previewTarget('b', s)).toMatchObject({ decided: 'rejected' });
  });

  it('falls back to the newest waiting draft when the opened one is gone (the demo day restarted)', () => {
    const s = new DashStore();
    waiting(s, 'a', 9);
    s.reset();
    expect(previewTarget('a', s).draft).toBeUndefined();
    waiting(s, 'c', 11);
    expect(previewTarget('a', s).draft?.id).toBe('c');
  });
});

describe('decidedNotice', () => {
  it('says "elsewhere" unless the person decided it here', () => {
    expect(decidedNotice('approved', false)).toBe('Approved elsewhere');
    expect(decidedNotice('rejected', false)).toBe('Rejected elsewhere');
    expect(decidedNotice('approved', true)).toBe('Approved');
    expect(decidedNotice('rejected', true)).toBe('Rejected');
    expect(decidedNotice('sent', false)).toBe('Sent');
    expect(decidedNotice('sent', true)).toBe('Sent');
  });
});

describe('focusAfterRebuild', () => {
  const kinds = ['approve', 'edit', 'reject', 'body', 'area', 'next', 'copy'] as const;

  it('returns to the same kind of control on the same draft', () => {
    expect(focusAfterRebuild({ kind: 'edit', id: 'a' }, { id: 'a', available: ['edit', 'reject'] })).toBe('edit');
    expect(focusAfterRebuild({ kind: 'reject', id: 'a' }, { id: 'a', available: ['edit', 'reject'] })).toBe('reject');
  });

  it('goes to the heading when the draft changed or the control is gone', () => {
    expect(focusAfterRebuild({ kind: 'edit', id: 'a' }, { id: 'b', available: ['edit'] })).toBe('heading');
    expect(focusAfterRebuild({ kind: 'reject', id: 'a' }, { id: 'a', available: ['edit'] })).toBe('heading');
    expect(focusAfterRebuild({ kind: 'edit', id: 'a' }, { id: undefined, available: [] })).toBe('heading');
    expect(focusAfterRebuild(undefined, { id: 'a', available: ['edit'] })).toBe('heading');
  });

  it('never returns approve, whatever was focused and whatever exists', () => {
    for (const kind of kinds) {
      for (const id of ['a', 'b', undefined]) {
        const r = focusAfterRebuild({ kind, id: 'a' }, { id, available: [...kinds] });
        expect(r).not.toBe('approve');
      }
    }
  });
});

// ---------------------------------------------------------------- A2: scripted decisions wait for an open editor

describe('ScriptHold', () => {
  const approved = (draftId: string): AgentEvent => ({ type: 'approved', draftId, mode: 'item' });
  const rejected = (draftId: string): AgentEvent => ({ type: 'rejected', draftId });
  const sent = (draftId: string): AgentEvent => ({ type: 'sent', draftId, channel: 'email' });

  it('holds approved, rejected and sent for the draft being edited, and nothing else', () => {
    let editing: string | undefined = 'x';
    const hold = new ScriptHold(() => editing);
    expect(hold.offer(approved('x'))).toBe(true);
    expect(hold.offer(rejected('x'))).toBe(true);
    expect(hold.offer(sent('x'))).toBe(true);
    expect(hold.offer(approved('y'))).toBe(false);
    expect(hold.offer({ type: 'awaiting_approval', draftId: 'x', agent: 'quill' })).toBe(false);
    expect(hold.offer({ type: 'run_started', runId: 'r', agent: 'quill', task: 't' })).toBe(false);
    editing = undefined;
    expect(hold.offer(approved('x'))).toBe(false); // no editor open: nothing is held
  });

  it('releases what it held, in order, once', () => {
    const hold = new ScriptHold(() => 'x');
    hold.offer(approved('x'));
    hold.offer(sent('x'));
    expect(hold.release()).toEqual([approved('x'), sent('x')]);
    expect(hold.release()).toEqual([]);
  });

  it('discards held events when the demo day restarts', () => {
    const hold = new ScriptHold(() => 'x');
    hold.offer(approved('x'));
    hold.discard();
    expect(hold.release()).toEqual([]);
  });
});

describe('ScriptHold when the editor switches straight from one draft to another', () => {
  const approved = (draftId: string): AgentEvent => ({ type: 'approved', draftId, mode: 'item' });
  const sent = (draftId: string): AgentEvent => ({ type: 'sent', draftId, channel: 'email' });

  it('releases the old draft\'s held events on the switch, so a later one cannot overtake them', () => {
    const emitted: AgentEvent[] = [];
    const held = holdScriptedDecisions((e) => emitted.push(e));
    try {
      setEditingId('X');
      held.handle(approved('X'));
      expect(emitted).toEqual([]); // held: X is being edited
      setEditingId('Y'); // Edit on another card, without closing first
      held.handle(sent('X'));
      expect(emitted).toEqual([approved('X'), sent('X')]); // in order; nothing for Y
    } finally {
      held.dispose();
      setEditingId(undefined);
    }
  });

  it('keeps holding events for the draft still being edited, and releases them when it closes', () => {
    const emitted: AgentEvent[] = [];
    const held = holdScriptedDecisions((e) => emitted.push(e));
    try {
      setEditingId('X');
      held.handle(approved('X'));
      setEditingId('Y');
      held.handle(approved('Y'));
      expect(emitted).toEqual([approved('X')]); // Y's stays held
      setEditingId(undefined);
      expect(emitted).toEqual([approved('X'), approved('Y')]);
    } finally {
      held.dispose();
      setEditingId(undefined);
    }
  });

  it('releaseStale hands back only events for drafts no longer edited, in order, once', () => {
    let editing: string | undefined = 'X';
    const hold = new ScriptHold(() => editing);
    hold.offer(approved('X'));
    hold.offer(sent('X'));
    editing = 'Y';
    hold.offer(approved('Y'));
    expect(hold.releaseStale()).toEqual([approved('X'), sent('X')]);
    expect(hold.releaseStale()).toEqual([]);
    editing = undefined;
    expect(hold.releaseStale()).toEqual([approved('Y')]);
  });

  it('a restart still discards everything', () => {
    const emitted: AgentEvent[] = [];
    const held = holdScriptedDecisions((e) => emitted.push(e));
    try {
      setEditingId('X');
      held.handle(approved('X'));
      held.discard();
      setEditingId('Y');
      setEditingId(undefined);
      expect(emitted).toEqual([]);
    } finally {
      held.dispose();
      setEditingId(undefined);
    }
  });
});

describe('lostEdit', () => {
  it('is true only when the typed text differs from what the editor opened with', () => {
    expect(lostEdit('Hello', 'Hello')).toBe(false);
    expect(lostEdit('Hello', 'Hello there')).toBe(true);
    expect(lostEdit('Hello', '')).toBe(true);
  });
});

// ---------------------------------------------------------------- B2: a card in edit mode cannot be decided

describe('approvalCard while editing', () => {
  const handlers = { onApprove() {}, onEdit() {}, onReject() {} };
  const rowFor = () => {
    const s = new DashStore();
    waiting(s, 'a', 9);
    return approvalRows(s)[0];
  };
  const button = (card: unknown, word: string): FakeNode =>
    all(card).find((n) => n.tag === 'button' && (n.attrs['aria-label'] ?? '').startsWith(word))!;

  it('disables Approve and Reject, and marks Edit disabled, while its editor is open', () => {
    const card = approvalCard(rowFor(), handlers, fh, fh('div'));
    expect('disabled' in button(card, 'Approve').attrs).toBe(true);
    expect('disabled' in button(card, 'Reject').attrs).toBe(true);
    expect(button(card, 'Edit').attrs['aria-disabled']).toBe('true');
  });

  it('leaves all three live without an editor', () => {
    const card = approvalCard(rowFor(), handlers, fh);
    expect('disabled' in button(card, 'Approve').attrs).toBe(false);
    expect('disabled' in button(card, 'Reject').attrs).toBe(false);
    expect(button(card, 'Edit').attrs['aria-disabled']).toBeUndefined();
  });
});

// ---------------------------------------------------------------- C items

describe('isPlanDraft', () => {
  it('is the one test for "approve all plan"', () => {
    const s = new DashStore();
    waiting(s, 'p', 9, { agent: 'muse', kind: 'plan' });
    waiting(s, 'e', 10);
    expect(isPlanDraft(s.draft('p')!)).toBe(true);
    expect(isPlanDraft(s.draft('e')!)).toBe(false);
  });
});

describe('agentFilter', () => {
  it('keeps a roster agent id and drops anything else', () => {
    expect(agentFilter('muse')).toBe('muse');
    expect(agentFilter('nobody')).toBeUndefined();
    expect(agentFilter('<img src=x>')).toBeUndefined();
    expect(agentFilter(undefined)).toBeUndefined();
  });
});

describe('Settings switch', () => {
  it('is named by its visible label (aria-labelledby, no separate aria-label)', () => {
    const row = switchRow('sound', 'Sounds', 'Soft cues.', { get: () => true, set() {} }, undefined, fh);
    const nodes = all(row.el);
    const button = nodes.find((n) => n.tag === 'button')!;
    const labelId = button.attrs['aria-labelledby'];
    expect(labelId).toBeTruthy();
    expect(button.attrs['aria-label']).toBeUndefined();
    const label = nodes.find((n) => n.attrs.id === labelId)!;
    expect(textOf(label)).toBe('Sounds');
  });
});

describe('Pause copy', () => {
  it('says Run now is blocked and the demo still plays', () => {
    expect(PAUSE_NOTE).toBe('Run now is blocked while paused. In the demo the scripted day still plays; real timetables pause from stage 3.');
  });
});
