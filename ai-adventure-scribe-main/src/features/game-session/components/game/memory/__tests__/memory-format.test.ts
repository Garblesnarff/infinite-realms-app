import { describe, it, expect } from 'vitest';

import { formatWhen, groupMemoriesByCategory, importanceLevel } from '../memory-format';

import type { Memory } from '../types';

const mem = (id: string, type: Memory['type'], importance = 5): Memory =>
  ({
    id,
    type,
    content: `memory ${id}`,
    importance,
    metadata: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  }) as Memory;

describe('importanceLevel', () => {
  it('maps the 1-10 importance scale to 1, 2 or 3 pips with a text label', () => {
    expect(importanceLevel(1)).toEqual({ pips: 1, label: 'Minor' });
    expect(importanceLevel(3)).toEqual({ pips: 1, label: 'Minor' });
    expect(importanceLevel(4)).toEqual({ pips: 2, label: 'Notable' });
    expect(importanceLevel(7)).toEqual({ pips: 2, label: 'Notable' });
    expect(importanceLevel(8)).toEqual({ pips: 3, label: 'Important' });
    expect(importanceLevel(10)).toEqual({ pips: 3, label: 'Important' });
  });
});

describe('formatWhen', () => {
  const now = new Date('2026-10-10T12:00:00.000Z').getTime();
  it('uses minutes, hours and days for recent memories', () => {
    expect(formatWhen('2026-10-10T11:59:40.000Z', now)).toBe('just now');
    expect(formatWhen('2026-10-10T11:30:00.000Z', now)).toBe('30 min ago');
    expect(formatWhen('2026-10-10T09:00:00.000Z', now)).toBe('3 hours ago');
    expect(formatWhen('2026-10-10T11:00:00.000Z', now)).toBe('1 hour ago');
    expect(formatWhen('2026-10-07T12:00:00.000Z', now)).toBe('3 days ago');
    expect(formatWhen('2026-10-09T12:00:00.000Z', now)).toBe('1 day ago');
  });
  it('returns an empty string for an invalid date', () => {
    expect(formatWhen('not-a-date', now)).toBe('');
  });
});

describe('groupMemoriesByCategory', () => {
  it('groups in category order, skips empty categories, and puts unknown types in Other', () => {
    const groups = groupMemoriesByCategory([
      mem('a', 'item'),
      mem('b', 'npc'),
      mem('c', 'npc'),
      mem('d', 'plot_point'),
    ]);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Characters', 2],
      ['Items', 1],
      ['Other', 1],
    ]);
  });
});
