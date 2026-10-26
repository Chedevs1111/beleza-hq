import { describe, it, expect } from 'vitest';
import { toCsv } from '../src/dash/csv';
import { createDemoActions } from '../src/dash/actions';
import { DashStore } from '../src/dash/store';
import { DEMO_DAY } from '../src/demo/script';
import { ROSTER } from '../src/roster';
import type { AgentId } from '../src/types';
import { CONNECTIONS, SCHEDULES, whyNotRunnable } from '../src/dash/settings-data';
import { USD_ZAR, WORKING_DAYS, spendRows, formatUsd, formatZar } from '../src/dash/pages/spend';
import { activityCsvRows, activityRows } from '../src/dash/pages/activity';

function fed(): DashStore {
  const store = new DashStore();
  for (const step of DEMO_DAY) store.accept(step.event, step.atHour);
  return store;
}

// ---------------------------------------------------------------- toCsv

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d');
  });

  it('quotes cells holding a comma, a quote or a line break, doubling inner quotes (RFC 4180)', () => {
    expect(toCsv([['a,b', 'say "hi"', 'one\ntwo', 'one\r\ntwo']])).toBe('"a,b","say ""hi""","one\ntwo","one\r\ntwo"');
  });

  it('leaves plain cells and empty cells unquoted', () => {
    expect(toCsv([['plain', '', ' spaced ']])).toBe('plain,, spaced ');
  });

  it('guards a cell starting with = + - @ tab or CR with a leading apostrophe', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      const out = toCsv([[`${lead}SUM(A1)`]]);
      const cell = out.replace(/^"|"$/g, '');
      expect(cell.startsWith(`'${lead}`)).toBe(true);
    }
    expect(toCsv([['=1+1']])).toBe("'=1+1");
    expect(toCsv([['@cmd']])).toBe("'@cmd");
  });

  it('guards first and then quotes: a guarded cell with a comma is quoted whole', () => {
    expect(toCsv([['=HYPERLINK("x","y")']])).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });

  it('does not guard a formula character that is not first', () => {
    expect(toCsv([['a=b', 'x-y', 'e@mail']])).toBe('a=b,x-y,e@mail');
  });

  it('is an empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });
});

// ---------------------------------------------------------------- spend

describe('spendRows', () => {
  it('uses the stated constants', () => {
    expect(USD_ZAR).toBe(18.5);
    expect(WORKING_DAYS).toBe(22);
  });

  it('has a row per agent in roster order, with today from spendToday() and month = today x 22', () => {
    const store = fed();
    const today = store.spendToday();
    const rows = spendRows(store, ROSTER);
    expect(rows.map((r) => r.agent)).toEqual(ROSTER.map((a) => a.id));
    expect(rows.map((r) => r.name)).toEqual(ROSTER.map((a) => a.name));
    for (const r of rows) {
      expect(r.today).toBeCloseTo(today.get(r.agent) ?? 0, 10);
      expect(r.month).toBeCloseTo((today.get(r.agent) ?? 0) * 22, 10);
    }
    expect(rows.find((r) => r.agent === 'scout')?.today).toBeCloseTo(0.18, 10);
    expect(rows.find((r) => r.agent === 'ledger')?.today).toBe(0);
  });

  it('sums to the whole demo day', () => {
    const store = fed();
    const sum = [...store.spendToday().values()].reduce((a, b) => a + b, 0);
    const rows = spendRows(store, ROSTER);
    expect(rows.reduce((a, r) => a + r.today, 0)).toBeCloseTo(sum, 10);
    expect(sum).toBeGreaterThan(0);
  });

  it('is all zero for a store that has seen nothing', () => {
    expect(spendRows(new DashStore(), ROSTER).every((r) => r.today === 0 && r.month === 0)).toBe(true);
  });

  it('formats dollars and rand to two places', () => {
    expect(formatUsd(0.18)).toBe('$0.18');
    expect(formatZar(1)).toBe('R18.50');
    expect(formatZar(0.18)).toBe('R3.33');
  });
});

// ---------------------------------------------------------------- activity

describe('activityRows', () => {
  it('is the store log newest first, a later arrival winning a tie', () => {
    const store = new DashStore();
    store.accept({ type: 'run_started', runId: 'r1', agent: 'scout', task: 'First' }, 7.5);
    store.accept({ type: 'run_started', runId: 'r2', agent: 'tempo', task: 'Second' }, 7.5);
    store.accept({ type: 'run_started', runId: 'r3', agent: 'echo', task: 'Third' }, 8);
    const rows = activityRows(store);
    expect(rows.map((r) => r.agent)).toEqual(['echo', 'tempo', 'scout']);
    expect(rows[0].time).toBe('08:00');
    expect(rows[0].agentName).toBe('Echo');
  });

  it('keeps only one agent when filtered, and an unknown filter shows nothing extra', () => {
    const store = fed();
    const scout = activityRows(store, 'scout');
    expect(scout.length).toBeGreaterThan(0);
    expect(scout.every((r) => r.agent === 'scout')).toBe(true);
    expect(activityRows(store).length).toBeGreaterThan(scout.length);
  });

  it('turns rows into time, agent, text CSV records under a header', () => {
    const store = fed();
    const rows = activityRows(store, 'scout');
    const csv = activityCsvRows(rows);
    expect(csv[0]).toEqual(['time', 'agent', 'text']);
    expect(csv).toHaveLength(rows.length + 1);
    expect(csv[1]).toEqual([rows[0].time, rows[0].agentName, rows[0].text]);
  });
});

// ---------------------------------------------------------------- schedules and connections

describe('SCHEDULES', () => {
  it('has all fifteen agents with the specified strings', () => {
    expect(SCHEDULES).toEqual({
      tempo: 'Daily 06:30',
      scout: 'Mon–Fri 07:30',
      echo: 'Daily 08:00',
      atlas: 'Mon–Fri 08:30 · monthly site check',
      quill: 'Mon–Fri 09:00',
      linx: 'Mon–Fri 09:00',
      forge: 'On each yes reply',
      muse: 'Mon 07:00',
      lumen: 'After a plan is approved',
      pulse: '09:00, 13:00, 17:00',
      sentinel: 'Every draft',
      herald: 'Daily 18:00',
      courier: 'Per approved item',
      ledger: 'Parked — waiting for first client',
      keeper: 'Parked — waiting for invoices',
    });
    expect(Object.keys(SCHEDULES).sort()).toEqual(ROSTER.map((a) => a.id).sort());
  });
});

describe('CONNECTIONS', () => {
  it('lists the six services and who uses them', () => {
    expect(CONNECTIONS.map((c) => c.name)).toEqual([
      'Afrihost mail',
      'Composio Instagram / Facebook / LinkedIn',
      'Higgsfield',
      'WhatsApp via Sent.dm / Meta',
      'Anthropic API',
      'Website (belezamedia.com)',
    ]);
    expect(CONNECTIONS[0].used).toContain('Echo');
    expect(CONNECTIONS[0].used).toContain('Courier');
    expect(CONNECTIONS[4].used).toContain('all');
    expect(CONNECTIONS[5].used).toContain('Atlas');
    expect(CONNECTIONS[5].used).toContain('Echo');
    expect(CONNECTIONS[5].step).toBe('website');
  });
});

// ---------------------------------------------------------------- pause, Run now and the reason it cannot

describe('Run now with a paused agent', () => {
  function rig(paused: Set<AgentId>) {
    const store = new DashStore();
    const emitted: unknown[] = [];
    const actions = createDemoActions({
      store,
      emit: (e) => {
        emitted.push(e);
        store.accept(e, 9);
      },
      later: () => {},
      paused: (a) => paused.has(a),
    });
    return { store, actions, emitted, paused };
  }

  it('returns undefined and emits nothing for a paused agent, and runs again once resumed', () => {
    const { actions, emitted, paused } = rig(new Set<AgentId>(['scout']));
    expect(actions.runNow('scout')).toBeUndefined();
    expect(emitted).toHaveLength(0);
    paused.delete('scout');
    expect(actions.runNow('scout')).toBe('scout-now-1');
  });

  it('whyNotRunnable names the reason: Parked, Paused, Already working, or nothing', () => {
    const { store, actions, paused } = rig(new Set<AgentId>());
    const ctx = { store, roster: ROSTER, paused };
    expect(whyNotRunnable('ledger', ctx)).toBe('Parked');
    expect(whyNotRunnable('scout', ctx)).toBeUndefined();
    paused.add('scout');
    expect(whyNotRunnable('scout', ctx)).toBe('Paused');
    paused.delete('scout');
    expect(actions.runNow('echo')).toBeDefined();
    expect(whyNotRunnable('echo', ctx)).toBe('Already working');
  });

  it('Parked wins over Paused, and Paused over Already working', () => {
    const { store, actions, paused } = rig(new Set<AgentId>(['keeper']));
    const ctx = { store, roster: ROSTER, paused };
    expect(whyNotRunnable('keeper', ctx)).toBe('Parked');
    actions.runNow('tempo');
    paused.add('tempo');
    expect(whyNotRunnable('tempo', ctx)).toBe('Paused');
  });

  it('agrees with runNow: whenever runNow refuses there is a reason, and whenever there is none it runs', () => {
    const { store, actions, paused } = rig(new Set<AgentId>(['pulse']));
    const ctx = { store, roster: ROSTER, paused };
    for (const a of ROSTER) {
      const reason = whyNotRunnable(a.id, ctx);
      const runId = actions.runNow(a.id);
      expect(runId === undefined).toBe(reason !== undefined);
    }
  });
});

describe('reasonText', () => {
  it('gives one sentence per reason, with the parked reason when there is one', async () => {
    const { reasonText } = await import('../src/dash/settings-data');
    expect(reasonText('Ledger', 'Parked', 'waiting for first client')).toBe('Ledger is parked: waiting for first client.');
    expect(reasonText('Ledger', 'Parked')).toBe('Ledger is parked.');
    expect(reasonText('Scout', 'Paused')).toBe('Scout is paused.');
    expect(reasonText('Scout', 'Already working')).toBe('Scout is already working.');
  });
});
