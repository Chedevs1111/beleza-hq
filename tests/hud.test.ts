import { describe, it, expect } from 'vitest';
import { formatClock, phaseLabel } from '../src/ui/hud';

describe('formatClock', () => {
  it('pads hours and minutes', () => {
    expect(formatClock(7.5)).toBe('07:30');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(18.25)).toBe('18:15');
  });
  it('never shows 60 minutes, and wraps 24 to midnight', () => {
    expect(formatClock(23.9999)).toBe('23:59');
    expect(formatClock(24)).toBe('00:00');
    expect(formatClock(-1)).toBe('23:00');
  });
  it('shows 00:00 for a non-number rather than NaN', () => {
    expect(formatClock(NaN)).toBe('00:00');
  });
  it('does not lose a minute to float error (10.1 h is 10:06)', () => {
    expect(formatClock(10.1)).toBe('10:06');
  });
});

describe('phaseLabel', () => {
  it('names the four phases', () => {
    expect(['morning', 'day', 'golden', 'night'].map((p) => phaseLabel(p as never))).toEqual(['Morning', 'Day', 'Golden hour', 'Night']);
  });
});
