import { describe, expect, it } from 'vitest';
import { frameFor, homeInsets, viewZoom } from '../src/dash/frame';

const v = (o: Partial<Parameters<typeof frameFor>[0]> = {}) => ({ width: 1440, height: 900, left: 0, right: 0, top: 0, bottom: 0, ...o });

describe('frameFor', () => {
  it('is the identity with no panels', () => {
    expect(frameFor(v())).toEqual({ dx: 0, dy: 0, zoom: 1 });
  });
  it('slides the picture right by half the left panel', () => {
    expect(frameFor(v({ left: 240 })).dx).toBe(120);
  });
  it('slides the picture left by half the right panel (agent card)', () => {
    expect(frameFor(v({ right: 360 })).dx).toBe(-180);
  });
  it('centres between both sides', () => {
    expect(frameFor(v({ left: 256, right: 364 }))).toEqual({ dx: -54, dy: 0, zoom: 1 });
  });
  it('slides down for a top panel and up for a bottom one', () => {
    expect(frameFor(v({ top: 80 })).dy).toBe(40);
    expect(frameFor(v({ bottom: 68 })).dy).toBe(-34);
    expect(frameFor(v({ top: 72, bottom: 72 })).dy).toBe(0);
  });
  it('ignores bad numbers', () => {
    expect(frameFor(v({ left: NaN, right: -10 }))).toEqual({ dx: 0, dy: 0, zoom: 1 });
  });
});

describe('viewZoom', () => {
  it('is 1 for a landscape view', () => {
    expect(viewZoom(1440, 900)).toBe(1);
  });
  it('zooms out in a tall view but never below one half', () => {
    expect(viewZoom(650, 1000)).toBeCloseTo(0.5, 5);
    expect(viewZoom(1000, 1000)).toBeCloseTo(1 / 1.3, 5);
    expect(viewZoom(100, 1000)).toBe(0.5);
  });
  it('survives a zero-sized view', () => {
    expect(viewZoom(0, 0)).toBe(1);
  });
});

describe('homeInsets', () => {
  const box = (o: Partial<{ top: number; right: number; bottom: number; left: number }>) => ({ top: 0, right: 0, bottom: 0, left: 0, ...o });
  // Desktop: a 240 px sidebar at the left, the island at the top, the team bar at the bottom.
  const desktop = { width: 1440, height: 900, phone: false, right: 0, sidebar: box({ left: 16, right: 256, top: 16, bottom: 884 }), island: box({ top: 16, bottom: 60 }), team: box({ top: 820, bottom: 884 }) };
  // Phone: the sidebar is a tab bar along the bottom edge; the team bar rides just above it.
  const phone = { width: 375, height: 812, phone: true, right: 0, sidebar: box({ left: 8, right: 367, top: 732, bottom: 804 }), island: box({ top: 12, bottom: 64 }), team: box({ top: 660, bottom: 724 }) };

  it('reads the sidebar as a left panel on a wide window', () => {
    expect(homeInsets(desktop)).toMatchObject({ left: 256, right: 0, top: 60, bottom: 80 });
  });
  it('never treats the phone tab bar as a left panel (the bug: its right edge is almost the window width)', () => {
    const v = homeInsets(phone);
    expect(v.left).toBe(0);
    expect(frameFor(v).dx).toBe(0);
  });
  it('covers the picture from the higher of the team bar and the tab bar on a phone', () => {
    expect(homeInsets(phone).bottom).toBe(812 - 660);
    expect(homeInsets({ ...phone, team: null }).bottom).toBe(812 - 732);
    expect(homeInsets({ ...phone, team: box({ top: 780, bottom: 790 }) }).bottom).toBe(812 - 732);
  });
  it('copes with a missing island or team bar and carries the card inset through', () => {
    expect(homeInsets({ ...desktop, island: null, team: null, right: 364 })).toMatchObject({ top: 0, bottom: 0, right: 364 });
  });
});
