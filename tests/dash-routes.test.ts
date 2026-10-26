import { describe, expect, it } from 'vitest';
import { NAV, PHONE_TABS, moreItems, parseRoute } from '../src/dash/shell';

const PAGES = ['home', 'approvals', 'leads', 'content', 'inbox', 'activity', 'insights', 'spend', 'settings'] as const;

describe('NAV', () => {
  it('lists the nine pages in order with exact labels', () => {
    expect(NAV.map((n) => n.id)).toEqual([...PAGES]);
    expect(NAV.map((n) => n.label)).toEqual(['Home', 'Approvals', 'Leads', 'Content', 'Inbox', 'Activity', 'Insights', 'Spend', 'Settings']);
  });
  it('keeps the welcome page out of the sidebar', () => {
    expect(NAV.some((n) => (n.id as string) === 'welcome')).toBe(false);
  });
  it('gives every entry an icon', () => {
    for (const n of NAV) expect(n.icon.length).toBeGreaterThan(0);
  });
});

describe('parseRoute', () => {
  it('reads every page', () => {
    for (const p of PAGES.filter((x) => x !== 'home')) expect(parseRoute(`#/${p}`)).toEqual({ page: p });
  });
  it('treats empty, bare hash and root as home', () => {
    expect(parseRoute('')).toEqual({ page: 'home' });
    expect(parseRoute('#')).toEqual({ page: 'home' });
    expect(parseRoute('#/')).toEqual({ page: 'home' });
    expect(parseRoute('#/home')).toEqual({ page: 'home' });
  });
  it('reads the welcome page and its step', () => {
    expect(parseRoute('#/welcome')).toEqual({ page: 'welcome' });
    expect(parseRoute('#/welcome?step=email')).toEqual({ page: 'welcome', filter: 'email' });
    expect(parseRoute('#/welcome?agent=muse')).toEqual({ page: 'welcome' });
    expect(parseRoute('#/leads?step=email')).toEqual({ page: 'leads' });
  });
  it('reads an agent filter', () => {
    expect(parseRoute('#/content?agent=muse')).toEqual({ page: 'content', filter: 'muse' });
    expect(parseRoute('#/leads?agent=scout')).toEqual({ page: 'leads', filter: 'scout' });
  });
  it('leaves the filter off when it is empty or absent', () => {
    expect('filter' in parseRoute('#/content')).toBe(false);
    expect('filter' in parseRoute('#/content?agent=')).toBe(false);
    expect('filter' in parseRoute('#/content?other=1')).toBe(false);
  });
  it('decodes the filter', () => {
    expect(parseRoute('#/inbox?agent=a%20b')).toEqual({ page: 'inbox', filter: 'a b' });
  });
  it('sends unknown pages and junk home', () => {
    expect(parseRoute('#/nope')).toEqual({ page: 'home' });
    expect(parseRoute('#/nope?agent=muse')).toEqual({ page: 'home', filter: 'muse' });
    expect(parseRoute('#///')).toEqual({ page: 'home' });
    expect(parseRoute('#/__proto__')).toEqual({ page: 'home' });
    expect(parseRoute('#/constructor')).toEqual({ page: 'home' });
    expect(parseRoute('garbage')).toEqual({ page: 'home' });
  });
  it('accepts a missing slash and a trailing one', () => {
    expect(parseRoute('#spend')).toEqual({ page: 'spend' });
    expect(parseRoute('#/spend/')).toEqual({ page: 'spend' });
  });
});

describe('phone tab bar', () => {
  it('shows Home, Approvals, Content and Activity as tabs (the fifth is More)', () => {
    expect([...PHONE_TABS]).toEqual(['home', 'approvals', 'content', 'activity']);
  });
  it('lists everything else in the More sheet, then Commands and the setup wizard', () => {
    expect(moreItems()).toEqual([
      { id: 'leads', label: 'Leads' },
      { id: 'inbox', label: 'Inbox' },
      { id: 'insights', label: 'Insights' },
      { id: 'spend', label: 'Spend' },
      { id: 'settings', label: 'Settings' },
      { id: 'commands', label: 'Commands' },
      { id: 'welcome', label: 'Set up connections' },
    ]);
  });
  it('leaves no page unreachable: tabs plus More cover every route', () => {
    const reachable = new Set<string>([...PHONE_TABS, ...moreItems().map((m) => m.id)]);
    for (const n of NAV) expect(reachable.has(n.id)).toBe(true);
    expect(reachable.has('welcome')).toBe(true);
  });
});
