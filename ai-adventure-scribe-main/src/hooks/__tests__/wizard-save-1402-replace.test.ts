import { describe, expect, it } from 'vitest';

import { mapWizardEquipmentToInventory } from '../use-character-save';

import type { Character } from '@/types/character';

function ch(overrides: Partial<Character>): Character {
  return {
    id: undefined,
    equipment: [],
    toolProficiencies: [],
    ...overrides,
  } as unknown as Character;
}

describe('mapWizardEquipmentToInventory replace (#1402r)', () => {
  it('Soldier + dice: has Dice set, no Deck of cards, other gear remains', () => {
    const c = ch({
      toolProficiencies: ['Gaming set (dice)'],
      equipment: ['Insignia of rank', 'Deck of cards', 'Common clothes'],
    });
    const inv = mapWizardEquipmentToInventory(c).map((i) => i.itemName ?? i.itemId);
    expect(inv).toContain('Dice set');
    expect(inv).not.toContain('Deck of cards');
    expect(inv).toContain('Insignia of rank');
    expect(inv).toContain('Common clothes');
  });

  it('Soldier + no choice: keeps Deck of cards, no Dice set', () => {
    const c = ch({
      toolProficiencies: [],
      equipment: ['Insignia of rank', 'Deck of cards', 'Common clothes'],
    });
    const inv = mapWizardEquipmentToInventory(c).map((i) => i.itemName ?? i.itemId);
    expect(inv).toContain('Deck of cards');
    expect(inv).not.toContain('Dice set');
  });

  it('Soldier + cards: only Deck of cards', () => {
    const c = ch({
      toolProficiencies: ['Gaming set (cards)'],
      equipment: ['Insignia of rank', 'Deck of cards', 'Common clothes'],
    });
    const inv = mapWizardEquipmentToInventory(c).map((i) => i.itemName ?? i.itemId);
    expect(inv).toContain('Deck of cards');
    expect(inv.filter((n) => n === 'Deck of cards').length).toBe(1);
    expect(inv).not.toContain('Dice set');
  });

  it('Criminal + chosen kit: kit present', () => {
    const c = ch({
      toolProficiencies: ['Gaming set (dice)'],
      equipment: ['A crowbar', '15 gp'],
    });
    const inv = mapWizardEquipmentToInventory(c).map((i) => i.itemName ?? i.itemId);
    expect(inv).toContain('Dice set');
  });

  it('Noble + chosen kit: kit present', () => {
    const c = ch({
      toolProficiencies: ['Gaming set (cards)'],
      equipment: ['Fine clothes', 'Signet ring'],
    });
    const inv = mapWizardEquipmentToInventory(c).map((i) => i.itemName ?? i.itemId);
    expect(inv).toContain('Deck of cards');
  });

  it('prior both kits + chosen dice => only Dice set', () => {
    const c = ch({
      toolProficiencies: ['Gaming set (dice)'],
      equipment: ['Deck of cards', 'Dice set'],
    });
    const inv = mapWizardEquipmentToInventory(c).map((i) => i.itemName ?? i.itemId);
    expect(inv).toContain('Dice set');
    expect(inv).not.toContain('Deck of cards');
  });
});
