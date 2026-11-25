import { describe, expect, it } from 'vitest';

import { darkvisionRangeFor } from '../index';

describe('darkvisionRangeFor', () => {
  it('returns null for human', () => {
    expect(darkvisionRangeFor('Human')).toBeNull();
  });

  it('returns 60 for elf', () => {
    expect(darkvisionRangeFor('Elf')).toBe(60);
  });

  it('returns 60 for dwarf', () => {
    expect(darkvisionRangeFor('Dwarf')).toBe(60);
  });

  it('returns 120 for drow subrace', () => {
    expect(darkvisionRangeFor('Elf', 'Drow')).toBe(120);
  });

  it('returns undefined for unknown race', () => {
    expect(darkvisionRangeFor('Martian')).toBeUndefined();
  });

  it('returns undefined for missing/empty', () => {
    expect(darkvisionRangeFor(null)).toBeUndefined();
    expect(darkvisionRangeFor('')).toBeUndefined();
    expect(darkvisionRangeFor(undefined)).toBeUndefined();
  });

  it('returns 60 for tiefling', () => {
    expect(darkvisionRangeFor('Tiefling')).toBe(60);
  });

  it('returns 120 for duergar subrace', () => {
    expect(darkvisionRangeFor('Dwarf', 'Duergar (Gray Dwarf)')).toBe(120);
  });

  it('returns 120 for deep gnome subrace', () => {
    expect(darkvisionRangeFor('Gnome', 'Deep Gnome (Svirfneblin)')).toBe(120);
  });

  it('returns undefined for custom lineage (player choice)', () => {
    expect(darkvisionRangeFor('Human', 'Custom Lineage')).toBeUndefined();
  });
});
