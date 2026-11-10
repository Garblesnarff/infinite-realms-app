/**
 * #1402 reopen: item names on Finalize, and chosen kit replaces the default.
 * Fixtures use the real producer `resolveBackgroundEquipment` and, where noted,
 * `getStartingEquipment` / `describeStartingEquipment`.
 */
import { describe, expect, it } from 'vitest';

import {
  describeStartingEquipment,
  resolveBackgroundEquipment,
} from '../equipment-selection/starting-equipment';

import type { Character } from '@/types/character';

import { backgrounds } from '@/data/backgroundOptions';
import { monk } from '@/data/classes/monk';
import { getStartingEquipment } from '@/data/equipmentOptions';

describe('Finalize equipment names (#1402r)', () => {
  it('lists package item names', () => {
    const outlander = backgrounds.find((b) => b.id === 'outlander')!;
    const character = {
      class: monk,
      background: outlander,
      selectedEquipmentOptionIndex: 0,
      equipment: [...outlander.equipment, 'Dagger', 'Staff'],
      currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    } as unknown as Character;
    const line = describeStartingEquipment(character);
    expect(line).toContain('Dagger');
    expect(line).toContain('Staff');
    expect(line).toContain('10 gp starting gold');
  });

  it('no choice says No equipment chosen', () => {
    const character = {
      class: monk,
      background: null,
      equipment: [],
    } as unknown as Character;
    expect(describeStartingEquipment(character)).toBe('No equipment chosen');
  });

  it('starting gold identified', () => {
    const character = {
      class: monk,
      background: null,
      selectedEquipmentOptionIndex: 1,
      equipment: [],
      currency: { cp: 0, sp: 0, ep: 0, gp: 14, pp: 0 },
    } as unknown as Character;
    expect(describeStartingEquipment(character)).toContain('Starting Gold');
    expect(describeStartingEquipment(character)).toContain('14 gp');
  });

  it('bare gp is gold not item', () => {
    const outlander = backgrounds.find((b) => b.id === 'outlander')!;
    const character = {
      class: monk,
      background: outlander,
      selectedEquipmentOptionIndex: 0,
      equipment: [...outlander.equipment, 'Dagger'],
      currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    } as unknown as Character;
    const line = describeStartingEquipment(character);
    expect(line).not.toContain('10 gp,');
  });

  it('resolver replaces default kit', () => {
    const soldier = backgrounds.find((b) => b.id === 'soldier')!;
    const resolved = resolveBackgroundEquipment(soldier, ['Gaming set (dice)']);
    expect(resolved).toContain('Dice set');
    expect(resolved).not.toContain('Deck of cards');
    expect(resolved).toContain('Insignia of rank');
  });

  it('resolver keeps default when no choice', () => {
    const soldier = backgrounds.find((b) => b.id === 'soldier')!;
    const resolved = resolveBackgroundEquipment(soldier, []);
    expect(resolved).toContain('Deck of cards');
    expect(resolved).not.toContain('Dice set');
  });

  it('resolver adds kit for no-default background', () => {
    const criminal = backgrounds.find((b) => b.id === 'criminal')!;
    const resolved = resolveBackgroundEquipment(criminal, ['Gaming set (cards)']);
    expect(resolved).toContain('Deck of cards');
  });

  it('lists names from resolveBackgroundEquipment + getStartingEquipment (Soldier dice + Fighter package)', () => {
    const soldier = backgrounds.find((b) => b.id === 'soldier')!;
    // Real producer: chosen Dice set replaces default Deck of cards.
    const backgroundItems = resolveBackgroundEquipment(soldier, ['Gaming set (dice)']);
    const packageNames = getStartingEquipment('Fighter').map((eq) => eq.name);
    const character = {
      class: { id: 'fighter', name: 'Fighter' },
      background: soldier,
      toolProficiencies: ['Gaming set (dice)'],
      selectedEquipmentOptionIndex: 0,
      equipment: [...backgroundItems, ...packageNames],
      currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    } as unknown as Character;
    const line = describeStartingEquipment(character);
    expect(line).toContain('Dice set');
    expect(line).not.toContain('Deck of cards');
    for (const name of packageNames) {
      expect(line).toContain(name);
    }
    expect(line).toContain('Insignia of rank');
    expect(line).toContain('10 gp starting gold');
    expect(line).not.toContain('10 gp,');
  });
});
