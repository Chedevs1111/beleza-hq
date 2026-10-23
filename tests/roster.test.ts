import { describe, it, expect } from 'vitest';
import { ROSTER, agentById, agentsInZone } from '../src/roster';

const IDS = [
  'tempo', 'scout', 'echo', 'atlas', 'quill', 'linx', 'forge', 'muse',
  'lumen', 'pulse', 'sentinel', 'herald', 'courier', 'ledger', 'keeper',
];

const ZONES = {
  growth: ['scout', 'quill', 'linx', 'forge'],
  studio: ['muse', 'lumen', 'pulse'],
  ops: ['echo', 'tempo', 'sentinel', 'herald', 'courier'],
  client: ['atlas', 'ledger', 'keeper'],
} as const;

describe('ROSTER', () => {
  it('has exactly the 15 unique agent ids', () => {
    expect(ROSTER).toHaveLength(15);
    expect(new Set(ROSTER.map((a) => a.id)).size).toBe(15);
    expect([...ROSTER.map((a) => a.id)].sort()).toEqual([...IDS].sort());
  });

  it.each(Object.entries(ZONES))('zone %s has exactly its members', (zone, members) => {
    const ids = agentsInZone(zone as keyof typeof ZONES).map((a) => a.id);
    expect([...ids].sort()).toEqual([...members].sort());
  });

  it('parks only ledger and keeper, with the exact reasons', () => {
    expect(agentById('ledger')).toMatchObject({ parked: true, parkedReason: 'waiting for first client' });
    expect(agentById('keeper')).toMatchObject({ parked: true, parkedReason: 'waiting for invoices' });
    for (const a of ROSTER.filter((a) => a.id !== 'ledger' && a.id !== 'keeper')) {
      expect(a.parked).toBe(false);
      expect(a.parkedReason).toBeUndefined();
    }
  });

  it('names are the capitalised ids', () => {
    for (const a of ROSTER) {
      expect(a.name).toBe(a.id[0].toUpperCase() + a.id.slice(1));
    }
  });

  it('every agent has a role and a distinct, non-placeholder look', () => {
    for (const a of ROSTER) {
      expect(a.role.length).toBeGreaterThan(0);
      expect(a.look.model.length).toBeGreaterThan(0);
      expect(a.look.model.startsWith('tbd-')).toBe(false);
    }
    expect(new Set(ROSTER.map((a) => a.look.model)).size).toBe(ROSTER.length);
  });
});
