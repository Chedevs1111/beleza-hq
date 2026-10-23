import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildStreak } from '../src/office/streak';
import { COURIER_WINDOW } from '../src/office/layout';

const visible = (g: THREE.Group) => g.children.filter((c) => c.visible) as THREE.Sprite[];

describe('buildStreak', () => {
  it('shows nothing until fired', () => {
    const s = buildStreak();
    s.update(1);
    expect(visible(s.group)).toHaveLength(0);
  });

  it('flies out through the windows (+x), climbing, and is gone after about two seconds', () => {
    const s = buildStreak();
    s.fire();
    s.update(10);
    s.update(11);
    const head = visible(s.group).sort((a, b) => b.position.x - a.position.x)[0];
    expect(head.position.x).toBeGreaterThan(COURIER_WINDOW[0] + 20);
    expect(head.position.y).toBeGreaterThan(1.35);
    s.update(13);
    expect(visible(s.group)).toHaveLength(0);
  });

  it('keeps several streaks in the air at once, and still takes a fourth by reusing the oldest', () => {
    const s = buildStreak();
    for (let i = 0; i < 4; i++) { s.fire(); s.update(i * 0.1); }
    expect(visible(s.group).length).toBeGreaterThan(12);
  });

  it('fades the trail: the head is the brightest sprite', () => {
    const s = buildStreak();
    s.fire();
    s.update(0);
    s.update(0.9);
    const ops = s.group.children.map((c) => (c as THREE.Sprite).material.opacity);
    expect(Math.max(...ops)).toBe(ops[0]);
    expect(ops[0]).toBeGreaterThan(0.5);
  });
});
