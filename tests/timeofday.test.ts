import { describe, it, expect } from 'vitest';
import { demoHour, johannesburgHour, lightingAt } from '../src/office/timeofday';

describe('lightingAt phases', () => {
  it.each([
    [7, 'morning'],
    [12, 'day'],
    [17.5, 'golden'],
    [21, 'night'],
  ] as const)('hour %s is %s', (hour, phase) => {
    expect(lightingAt(hour).phase).toBe(phase);
  });

  it('wraps early-morning hours into night', () => {
    expect(lightingAt(3).phase).toBe('night');
    expect(lightingAt(27).phase).toBe(lightingAt(3).phase);
  });
});

describe('lightingAt values', () => {
  it('has the sun below the horizon at 21 and high at 12', () => {
    expect(lightingAt(21).sunElevationDeg).toBeLessThan(0);
    expect(lightingAt(12).sunElevationDeg).toBeGreaterThan(40);
  });

  it('lights the office and shore at night, not at noon', () => {
    expect(lightingAt(21).interiorLights).toBeGreaterThanOrEqual(0.9);
    expect(lightingAt(12).interiorLights).toBeLessThanOrEqual(0.4);
    expect(lightingAt(12).shoreLights).toBe(0);
    expect(lightingAt(21).shoreLights).toBeGreaterThanOrEqual(0.8);
    expect(lightingAt(21).ledGlow).toBeGreaterThan(lightingAt(12).ledGlow);
  });

  it('keeps ranges sane across the whole day', () => {
    for (let m = 0; m < 24 * 60; m++) {
      const l = lightingAt(m / 60);
      for (const v of [l.interiorLights, l.ledGlow, l.shoreLights]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(l.exposure).toBeGreaterThanOrEqual(0.8);
      expect(l.exposure).toBeLessThanOrEqual(1.1);
      expect(l.sunAzimuthDeg).toBeGreaterThanOrEqual(0);
      expect(l.sunAzimuthDeg).toBeLessThan(360);
      expect(l.sunColor).toBeGreaterThanOrEqual(0);
      expect(l.sunColor).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('changes sunIntensity smoothly (under 0.05 per minute), including across midnight', () => {
    let prev = lightingAt(0).sunIntensity;
    for (let m = 1; m <= 24 * 60; m++) {
      const cur = lightingAt(m / 60).sunIntensity;
      expect(Math.abs(cur - prev)).toBeLessThan(0.05);
      prev = cur;
    }
  });
});

describe('johannesburgHour', () => {
  it('converts UTC to SAST (UTC+2)', () => {
    expect(johannesburgHour(new Date('2026-10-22T10:30:00Z'))).toBe(12.5);
  });

  it('wraps past midnight and includes seconds', () => {
    expect(johannesburgHour(new Date('2026-10-22T22:00:00Z'))).toBe(0);
    expect(johannesburgHour(new Date('2026-10-22T10:00:36Z'))).toBeCloseTo(12.01, 5);
  });
});

describe('demoHour', () => {
  it('starts at 06:00 and wraps each day', () => {
    expect(demoHour(0)).toBe(6);
    expect(demoHour(600)).toBe(6);
    expect(demoHour(1200)).toBe(6);
  });

  it('advances a full day over secondsPerDay', () => {
    expect(demoHour(150)).toBe(12);
    expect(demoHour(300)).toBe(18);
    expect(demoHour(30, 60)).toBe(18);
  });
});
