import { describe, expect, it, vi } from 'vitest';
import { buildCommands, dictationHandler, parseUtterance, rankCommands } from '../src/dash/palette';
import type { Run } from '../src/dash/palette';
import { NAV } from '../src/dash/shell';
import { ROSTER } from '../src/roster';

const commands = buildCommands(ROSTER);
const byTitle = (t: string) => commands.find((c) => c.title === t);
const cmd = (title: string, hint = ''): { id: string; title: string; hint: string; run: Run } => ({
  id: title, title, hint, run: { kind: 'toggle', what: 'sound' },
});

describe('buildCommands', () => {
  it('has Run <Name> for every working agent and none for the parked pair', () => {
    const runs = commands.filter((c) => c.run.kind === 'run');
    expect(runs).toHaveLength(ROSTER.filter((a) => !a.parked).length);
    expect(byTitle('Run Scout')?.run).toEqual({ kind: 'run', agent: 'scout' });
    expect(byTitle('Run Ledger')).toBeUndefined();
    expect(byTitle('Run Keeper')).toBeUndefined();
    expect(commands.some((c) => /ledger|keeper/i.test(c.title))).toBe(false);
  });

  it("opens the studio agents' work in Content and everyone else's in Activity", () => {
    expect(byTitle("Show Muse's work")?.run).toEqual({ kind: 'page', page: 'content', filter: 'muse' });
    expect(byTitle("Show Lumen's work")?.run).toEqual({ kind: 'page', page: 'content', filter: 'lumen' });
    expect(byTitle("Show Pulse's work")?.run).toEqual({ kind: 'page', page: 'content', filter: 'pulse' });
    expect(byTitle("Show Scout's work")?.run).toEqual({ kind: 'page', page: 'activity', filter: 'scout' });
    expect(byTitle("Show Sentinel's work")?.run).toEqual({ kind: 'page', page: 'activity', filter: 'sentinel' });
  });

  it('has an Insights page command between Activity and Spend', () => {
    expect(byTitle('Insights')?.run).toEqual({ kind: 'page', page: 'insights' });
    const pages = commands.filter((c) => c.id.startsWith('page:')).map((c) => c.title);
    expect(pages.indexOf('Insights')).toBe(pages.indexOf('Activity') + 1);
    expect(pages.indexOf('Spend')).toBe(pages.indexOf('Insights') + 1);
  });

  it("has What's waiting? (Approvals), Approve all plan, every page and the three toggles", () => {
    expect(byTitle("What's waiting?")?.run).toEqual({ kind: 'page', page: 'approvals' });
    expect(byTitle('Approve all plan')?.run).toEqual({ kind: 'approve-plan' });
    for (const n of NAV) expect(commands.some((c) => c.run.kind === 'page' && c.run.page === n.id && !c.run.filter && c.title !== "What's waiting?")).toBe(true);
    const toggles = commands.filter((c) => c.run.kind === 'toggle').map((c) => (c.run as { what: string }).what);
    expect(toggles.sort()).toEqual(['dictation', 'lite', 'sound']);
  });

  it('has a Set up connections command that opens the welcome wizard', () => {
    expect(byTitle('Set up connections')?.run).toEqual({ kind: 'page', page: 'welcome' });
  });

  it('gives every command a unique id and a hint', () => {
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
    for (const c of commands) expect(c.hint.length).toBeGreaterThan(0);
  });
});

describe('rankCommands', () => {
  it('puts a prefix before a word start before a substring', () => {
    const list = [cmd('Xscout thing'), cmd('Run Scout'), cmd('Scout first')];
    expect(rankCommands(list, 'scout').map((c) => c.title)).toEqual(['Scout first', 'Run Scout', 'Xscout thing']);
  });

  it('keeps the original order between equal scores', () => {
    const list = [cmd('Run Echo'), cmd('Run Atlas'), cmd('Run Quill')];
    expect(rankCommands(list, 'run').map((c) => c.title)).toEqual(['Run Echo', 'Run Atlas', 'Run Quill']);
  });

  it('is case-insensitive, ignores surrounding spaces and needs every word to match', () => {
    expect(rankCommands(commands, '  RUN  scout ')[0].title).toBe('Run Scout');
    expect(rankCommands(commands, 'run zzzz')).toEqual([]);
  });

  it('can match the hint as well as the title, after title matches', () => {
    const list = [cmd('Alpha', 'finds leads'), cmd('Leads page')];
    expect(rankCommands(list, 'leads').map((c) => c.title)).toEqual(['Leads page', 'Alpha']);
  });

  it('respects the limit (default 8) and returns suggestions for an empty query', () => {
    expect(rankCommands(commands, 'run').length).toBe(8);
    expect(rankCommands(commands, 'run', 3).length).toBe(3);
    expect(rankCommands(commands, '').length).toBe(8);
    expect(rankCommands(commands, '   ', 2).length).toBe(2);
  });
});

describe('parseUtterance', () => {
  it('"run scout"', () => {
    expect(parseUtterance('run scout')).toEqual({ kind: 'run', agent: 'scout' });
    expect(parseUtterance('  Run Scout. ')).toEqual({ kind: 'run', agent: 'scout' });
  });

  it('"approve all plan"', () => {
    expect(parseUtterance('approve all plan')).toEqual({ kind: 'approve-plan' });
    expect(parseUtterance('Approve all plans!')).toEqual({ kind: 'approve-plan' });
  });

  it('"show muse\'s posts" goes to Content filtered to Muse', () => {
    const want = { kind: 'page', page: 'content', filter: 'muse' };
    expect(parseUtterance("show muse's posts")).toEqual(want);
    expect(parseUtterance('Show Muse’s posts.')).toEqual(want);
    expect(parseUtterance('show muse work')).toEqual(want);
    expect(parseUtterance("show scout's work")).toEqual({ kind: 'page', page: 'activity', filter: 'scout' });
  });

  it('"what\'s waiting"', () => {
    const want = { kind: 'page', page: 'approvals' };
    expect(parseUtterance("what's waiting")).toEqual(want);
    expect(parseUtterance('What’s waiting?')).toEqual(want);
    expect(parseUtterance('whats waiting')).toEqual(want);
    expect(parseUtterance('what is waiting')).toEqual(want);
  });

  it('turns a parked agent into a run too, so the app can say it is parked', () => {
    expect(parseUtterance('run ledger')).toEqual({ kind: 'run', agent: 'ledger' });
  });

  it('returns undefined for anything else', () => {
    for (const junk of ['', '   ', 'hello there', 'run', 'run nobody', 'run scout and echo', 'show', "show nobody's work", 'delete everything', 'approve all', '???']) {
      expect(parseUtterance(junk), junk).toBeUndefined();
    }
  });
});

describe('dictationHandler', () => {
  const setup = (state = { open: true, on: true }) => {
    const h = { fill: vi.fn(), execute: vi.fn(), say: vi.fn() };
    const onText = dictationHandler({ isOpen: () => state.open, dictationOn: () => state.on, ...h });
    return { state, onText, ...h };
  };

  it('fills the input while hearing and runs a recognised final command', () => {
    const { onText, fill, execute } = setup();
    onText('run sc', false);
    expect(fill).toHaveBeenCalledWith('run sc');
    expect(execute).not.toHaveBeenCalled();
    onText('run scout', true);
    expect(execute).toHaveBeenCalledWith({ kind: 'run', agent: 'scout' });
  });

  it('says so, and runs nothing, when a final phrase is not a command', () => {
    const { onText, execute, say } = setup();
    onText('hello there', true);
    expect(execute).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalled();
  });

  it('does nothing at all once dictation is switched off: no fill, no run', () => {
    const { state, onText, fill, execute, say } = setup();
    state.on = false;
    onText('run scout', true);
    onText('approve all plan', false);
    expect(fill).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  it('does nothing once the bar is closed', () => {
    const { state, onText, fill, execute } = setup();
    state.open = false;
    onText('run scout', true);
    expect(fill).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
