import { describe, expect, it } from 'vitest';

import { getRacialSpells } from '../racial-spells';

import { elf } from '@/data/races/elf';
import { tiefling } from '@/data/races/tiefling';

describe('getRacialSpells level gating', () => {
  const standardTiefling = tiefling.subraces?.find((s) => s.id === 'standard-tiefling');
  const drow = elf.subraces?.find((s) => s.id === 'drow');

  it('Standard Tiefling level 1 gets thaumaturgy cantrip but no hellish-rebuke spell', () => {
    expect(standardTiefling).toBeDefined();
    const result = getRacialSpells(tiefling.name, standardTiefling, 1);
    expect(result.cantrips).toContain('thaumaturgy');
    expect(result.spells).not.toContain('hellish-rebuke');
  });

  it('Standard Tiefling level 2 gets no hellish-rebuke spell', () => {
    expect(standardTiefling).toBeDefined();
    const result = getRacialSpells(tiefling.name, standardTiefling, 2);
    expect(result.spells).not.toContain('hellish-rebuke');
  });

  it('Standard Tiefling level 3 gets hellish-rebuke spell', () => {
    expect(standardTiefling).toBeDefined();
    const result = getRacialSpells(tiefling.name, standardTiefling, 3);
    expect(result.spells).toContain('hellish-rebuke');
  });

  it('Drow subrace level 1 gets dancing-lights cantrip but no faerie-fire spell', () => {
    expect(drow).toBeDefined();
    const result = getRacialSpells(elf.name, drow, 1);
    expect(result.cantrips).toContain('dancing-lights');
    expect(result.spells).not.toContain('faerie-fire');
  });

  it('Drow subrace level 2 gets no faerie-fire spell', () => {
    expect(drow).toBeDefined();
    const result = getRacialSpells(elf.name, drow, 2);
    expect(result.spells).not.toContain('faerie-fire');
  });

  it('Drow subrace level 3 gets faerie-fire spell', () => {
    expect(drow).toBeDefined();
    const result = getRacialSpells(elf.name, drow, 3);
    expect(result.spells).toContain('faerie-fire');
  });
});
