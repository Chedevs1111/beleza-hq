import { describe, it, expect } from 'vitest';
import { h, hIn } from '../src/dash/dom';
import type { HFn } from '../src/dash/dom';
import { INBOX, LEADS, SCHEDULE } from '../src/dash/sample';
import { approvalRows, contentItems, hourLabel, inboxRows, leadRows } from '../src/dash/rows';
import { approvalCard, editorValid, saveEdit } from '../src/dash/pages/approvals';
import { leadRow } from '../src/dash/pages/leads';
import { draftItem, weekItem } from '../src/dash/pages/content';
import { inboxItem } from '../src/dash/pages/inbox';
import { DashStore } from '../src/dash/store';
import type { DraftKind } from '../src/events';
import type { AgentId } from '../src/types';

// ---- a minimal fake document: only createElement / createTextNode, as the brief asks

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

const asNode = (x: unknown): FakeNode => x as FakeNode;
function walk(n: FakeNode, out: FakeNode[] = []): FakeNode[] {
  out.push(n);
  for (const c of n.children) walk(c, out);
  return out;
}
const tagsOf = (x: unknown): string[] => walk(asNode(x)).flatMap((n) => (n.tag ? [n.tag] : []));
const textsOf = (x: unknown): string[] => walk(asNode(x)).flatMap((n) => (n.data !== undefined ? [n.data] : []));

const HOSTILE = '<img src=x onerror=alert(1)>';

// ---- store helpers

function waiting(store: DashStore, draftId: string, at: number, opts: { agent?: AgentId; kind?: DraftKind; summary?: string } = {}): void {
  const agent = opts.agent ?? 'quill';
  const runId = `${draftId}-run`;
  store.accept({ type: 'run_started', runId, agent, task: 'Seed' }, at - 0.3);
  store.accept({ type: 'draft_submitted', runId, agent, draftId, kind: opts.kind ?? 'email', summary: opts.summary ?? `Summary of ${draftId}` }, at - 0.2);
  store.accept({ type: 'sentinel_result', draftId, pass: true, reasons: [] }, at - 0.1);
  store.accept({ type: 'awaiting_approval', draftId, agent }, at);
}

// ---------------------------------------------------------------- h()

describe('h', () => {
  it('builds an element with attributes and children in order', () => {
    const el = asNode(fh('p', { class: 'x', id: 'y' }, 'one', fh('b', {}, 'two'), 'three'));
    expect(el.tag).toBe('p');
    expect(el.attrs).toEqual({ class: 'x', id: 'y' });
    expect(el.children.map((c) => c.tag ?? c.data)).toEqual(['one', 'b', 'three']);
  });

  it('turns a string child into a text node, never parsing it as HTML', () => {
    const el = asNode(hIn(fakeDoc, 'p', {}, HOSTILE));
    expect(el.children).toHaveLength(1);
    expect(el.children[0].tag).toBeUndefined();
    expect(el.children[0].data).toBe(HOSTILE);
    expect(tagsOf(el)).toEqual(['p']);
  });

  it('works without attributes', () => {
    const el = asNode(hIn(fakeDoc, 'span', undefined, 'hi'));
    expect(el.attrs).toEqual({});
    expect(el.children[0].data).toBe('hi');
  });

  it('never sets an inline event-handler attribute', () => {
    const el = asNode(hIn(fakeDoc, 'a', { href: '#/x', onclick: 'alert(1)', onerror: 'alert(2)' }, 'go'));
    expect(el.attrs).toEqual({ href: '#/x' });
  });

  it('is exported for the real document too', () => {
    expect(typeof h).toBe('function');
  });
});

// ---------------------------------------------------------------- sample data

describe('sample data', () => {
  it('has the sizes the brief asks for', () => {
    expect(LEADS).toHaveLength(12);
    expect(INBOX).toHaveLength(8);
    expect(SCHEDULE).toHaveLength(7);
  });

  it('has unique ids and all three grades', () => {
    expect(new Set(LEADS.map((l) => l.id)).size).toBe(12);
    expect(new Set(INBOX.map((m) => m.id)).size).toBe(8);
    expect(new Set(LEADS.map((l) => l.grade))).toEqual(new Set(['A', 'B', 'C']));
  });

  it('keeps every address on example.co.za or example.com and has no http', () => {
    const text = JSON.stringify({ LEADS, INBOX, SCHEDULE });
    expect(text).not.toMatch(/http/i);
    const domains = [...text.matchAll(/@([^\s"<>,]+)/g)].map((m) => m[1]);
    expect(domains.length).toBeGreaterThan(0);
    for (const d of domains) expect(['example.co.za', 'example.com']).toContain(d);
    for (const m of INBOX) expect(m.from).toMatch(/@example\.(co\.za|com)\b/);
  });

  it('covers every inbox class', () => {
    expect(new Set(INBOX.map((m) => m.cls))).toEqual(new Set(['yes', 'question', 'not-now', 'opt-out']));
  });
});

// ---------------------------------------------------------------- approvalRows

describe('approvalRows', () => {
  it('lists only waiting drafts, newest first', () => {
    const store = new DashStore();
    waiting(store, 'a', 9);
    waiting(store, 'b', 11);
    waiting(store, 'c', 10);
    store.accept({ type: 'run_started', runId: 'x', agent: 'echo', task: 'T' }, 12);
    store.accept({ type: 'draft_submitted', runId: 'x', agent: 'echo', draftId: 'd', kind: 'email', summary: 'still checking' }, 12);
    store.accept({ type: 'approved', draftId: 'a', mode: 'item' }, 12.1);
    expect(approvalRows(store).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('puts the later arrival first on a tie', () => {
    const store = new DashStore();
    waiting(store, 'a', 9);
    waiting(store, 'b', 9);
    expect(approvalRows(store).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('carries agent, kind, summary, body, the Sentinel result and the time', () => {
    const store = new DashStore();
    waiting(store, 'a', 9.5, { agent: 'muse', kind: 'plan', summary: 'Next week' });
    const [r] = approvalRows(store);
    expect(r).toMatchObject({ id: 'a', agent: 'muse', agentName: 'Muse', kind: 'plan', kindLabel: 'Plan', summary: 'Next week', plan: true, time: '09:30' });
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.sentinel).toBe("Passed Sentinel's check");
  });

  it('keeps markup in a summary as plain text', () => {
    const store = new DashStore();
    waiting(store, 'a', 9, { summary: HOSTILE });
    expect(approvalRows(store)[0].summary).toBe(HOSTILE);
  });

  it('is empty for an empty store', () => {
    expect(approvalRows(new DashStore())).toEqual([]);
  });
});

describe('hourLabel', () => {
  it('formats a demo hour as HH:MM and wraps past midnight', () => {
    expect(hourLabel(7)).toBe('07:00');
    expect(hourLabel(9.5)).toBe('09:30');
    expect(hourLabel(25.25)).toBe('01:15');
  });
});

// ---------------------------------------------------------------- leadRows

describe('leadRows', () => {
  it('returns every lead, A before B before C, keeping the given order within a grade', () => {
    const rows = leadRows(LEADS);
    expect(rows).toHaveLength(12);
    const grades = rows.map((r) => r.grade).join('');
    expect(grades).toBe([...grades].sort().join(''));
    const bs = rows.filter((r) => r.grade === 'B').map((r) => r.id);
    expect(bs).toEqual(LEADS.filter((l) => l.grade === 'B').map((l) => l.id));
  });

  it('filters by grade', () => {
    for (const g of ['A', 'B', 'C'] as const) {
      const rows = leadRows(LEADS, g);
      expect(rows.length).toBe(LEADS.filter((l) => l.grade === g).length);
      expect(rows.every((r) => r.grade === g)).toBe(true);
    }
  });

  it('labels the status and names the agent', () => {
    const dnc = leadRows(LEADS).find((r) => r.status === 'do-not-contact');
    expect(dnc?.statusLabel).toBe('Do not contact');
    expect(dnc?.agentName.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- contentItems

describe('contentItems', () => {
  it('returns Muse\'s week and every post, LinkedIn and comment draft, newest first', () => {
    const store = new DashStore();
    waiting(store, 'p1', 9, { agent: 'muse', kind: 'post' });
    waiting(store, 'l1', 11, { agent: 'linx', kind: 'linkedin' });
    waiting(store, 'c1', 10, { agent: 'pulse', kind: 'comment' });
    waiting(store, 'e1', 12, { agent: 'quill', kind: 'email' });
    waiting(store, 'pl', 13, { agent: 'muse', kind: 'plan' });
    const c = contentItems(store, SCHEDULE);
    expect(c.week).toHaveLength(7);
    expect(c.drafts.map((d) => d.id)).toEqual(['l1', 'c1', 'p1']);
  });

  it('filters drafts by agent and shows the week only for Muse', () => {
    const store = new DashStore();
    waiting(store, 'p1', 9, { agent: 'muse', kind: 'post' });
    waiting(store, 'c1', 10, { agent: 'pulse', kind: 'comment' });
    const muse = contentItems(store, SCHEDULE, 'muse');
    expect(muse.week).toHaveLength(7);
    expect(muse.drafts.map((d) => d.id)).toEqual(['p1']);
    const pulse = contentItems(store, SCHEDULE, 'pulse');
    expect(pulse.week).toEqual([]);
    expect(pulse.drafts.map((d) => d.id)).toEqual(['c1']);
  });

  it('shows the status of each draft', () => {
    const store = new DashStore();
    waiting(store, 'p1', 9, { agent: 'muse', kind: 'post' });
    store.accept({ type: 'approved', draftId: 'p1', mode: 'item' }, 9.1);
    expect(contentItems(store, SCHEDULE).drafts[0]).toMatchObject({ status: 'approved', statusLabel: 'Approved' });
  });
});

// ---------------------------------------------------------------- inboxRows

describe('inboxRows', () => {
  it('adds the linked draft status and keeps the given order', () => {
    const store = new DashStore();
    const linked = INBOX.filter((m) => m.draftId);
    expect(linked.length).toBeGreaterThan(0);
    const id = linked[0].draftId as string;
    waiting(store, id, 9, { agent: 'echo' });
    const rows = inboxRows(INBOX, store);
    expect(rows.map((r) => r.id)).toEqual(INBOX.map((m) => m.id));
    const row = rows.find((r) => r.draftId === id);
    expect(row?.draftStatus).toBe('waiting');
    expect(row?.draftLabel).toBe('Reply waiting for you');
  });

  it('leaves the status off when the draft is not in the store (or there is none)', () => {
    const rows = inboxRows(INBOX, new DashStore());
    expect(rows.every((r) => r.draftStatus === undefined)).toBe(true);
    expect(rows.find((r) => r.cls === 'opt-out')?.draftId).toBeUndefined();
  });
});

// ---------------------------------------------------------------- markup stays text everywhere (Review Focus 3)

describe('hostile text is rendered as text', () => {
  it('in an approval card', () => {
    const store = new DashStore();
    waiting(store, 'a', 9, { summary: HOSTILE });
    const [row] = approvalRows(store);
    const card = approvalCard({ ...row, body: HOSTILE }, { onApprove() {}, onEdit() {}, onReject() {} }, fh);
    expect(tagsOf(card)).not.toContain('img');
    expect(textsOf(card).filter((t) => t === HOSTILE).length).toBeGreaterThanOrEqual(2);
  });

  it('in a lead row', () => {
    const row = { ...leadRows(LEADS)[0], business: HOSTILE, area: HOSTILE };
    const tr = leadRow(row, fh);
    expect(tagsOf(tr)).not.toContain('img');
    expect(textsOf(tr)).toContain(HOSTILE);
  });

  it('in a content draft and a week item', () => {
    const store = new DashStore();
    waiting(store, 'p1', 9, { agent: 'muse', kind: 'post', summary: HOSTILE });
    const [d] = contentItems(store, SCHEDULE).drafts;
    const li = draftItem(d, fh);
    expect(tagsOf(li)).not.toContain('img');
    expect(textsOf(li)).toContain(HOSTILE);
    const w = weekItem({ ...SCHEDULE[0], hook: HOSTILE }, fh);
    expect(tagsOf(w)).not.toContain('img');
    expect(textsOf(w)).toContain(HOSTILE);
  });

  it('in an inbox item', () => {
    const row = { ...inboxRows(INBOX, new DashStore())[0], from: HOSTILE, subject: HOSTILE };
    const li = inboxItem(row, fh);
    expect(tagsOf(li)).not.toContain('img');
    expect(textsOf(li).filter((t) => t === HOSTILE)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- the editor and a store reset (Review Focus 2)

describe('editor safety', () => {
  const snapOf = (store: DashStore, id: string) => {
    const d = store.draft(id);
    if (!d) throw new Error('no draft');
    return { id: d.id, at: d.at, runId: d.runId };
  };

  it('is valid while the draft waits unchanged', () => {
    const store = new DashStore();
    waiting(store, 'a', 9);
    expect(editorValid(store, snapOf(store, 'a'))).toBe(true);
  });

  it('is invalid once the draft is decided', () => {
    const store = new DashStore();
    waiting(store, 'a', 9);
    const snap = snapOf(store, 'a');
    store.accept({ type: 'rejected', draftId: 'a' }, 9.5);
    expect(editorValid(store, snap)).toBe(false);
  });

  it('is invalid after the store resets, even if the same id comes back waiting at the same hour', () => {
    const store = new DashStore();
    waiting(store, 'a', 9);
    const snap = snapOf(store, 'a');
    store.reset();
    expect(editorValid(store, snap)).toBe(false);
  });

  it('saves into a waiting draft, which keeps waiting', () => {
    const store = new DashStore();
    waiting(store, 'a', 9);
    expect(saveEdit(store, snapOf(store, 'a'), 'Reworded text')).toBe(true);
    expect(store.draft('a')).toMatchObject({ body: 'Reworded text', status: 'waiting' });
    expect(approvalRows(store).map((r) => r.id)).toEqual(['a']);
  });

  it('does not save after a reset', () => {
    const store = new DashStore();
    waiting(store, 'a', 9);
    const snap = snapOf(store, 'a');
    store.reset();
    expect(saveEdit(store, snap, 'Late edit')).toBe(false);
    expect(store.draft('a')).toBeUndefined();
  });
});
