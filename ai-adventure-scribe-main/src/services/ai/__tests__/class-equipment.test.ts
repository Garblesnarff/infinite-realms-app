import { describe, it, expect } from 'vitest';

import { getClassEquipment } from '../class-equipment';

describe('getClassEquipment', () => {
  it('should return correct equipment for Fighter', () => {
    const result = getClassEquipment('Fighter');
    expect(result.weapons).toContain('Longsword (1d8)');
    expect(result.armor).toContain('Chain mail (AC 16)');
  });

  it('should return correct equipment for Rogue', () => {
    const result = getClassEquipment('rogue');
    expect(result.weapons).toContain('Rapier (1d8)');
    expect(result.armor).toContain('Leather armor (AC 11)');
  });

  it('should return correct equipment for Wizard', () => {
    const result = getClassEquipment('WIZARD');
    expect(result.weapons).toContain('Quarterstaff (1d6)');
    expect(result.armor).toContain('No armor (AC 10)');
  });

  it('should return correct equipment for Monk', () => {
    const result = getClassEquipment('Monk');
    expect(result.weapons).toContain('Unarmed Strike (1d4)');
    expect(result.armor).toContain('Unarmored (AC 10 + Dex + Wis)');
  });

  it('should return default equipment for unknown class', () => {
    const result = getClassEquipment('Baker');
    expect(result.weapons).toContain('Longsword (1d8)');
    expect(result.armor).toBe('Leather armor (AC 11)');
  });

  it('should handle all predefined classes', () => {
    const classes = [
      'fighter', 'rogue', 'ranger', 'barbarian', 'wizard',
      'sorcerer', 'warlock', 'cleric', 'druid', 'paladin',
      'bard', 'monk'
    ];

    classes.forEach(cls => {
      const result = getClassEquipment(cls);
      expect(result.weapons.length).toBeGreaterThan(0);
      expect(result.armor).toBeDefined();
    });
  });
});
