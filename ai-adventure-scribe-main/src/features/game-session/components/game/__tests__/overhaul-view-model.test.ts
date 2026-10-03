import { describe, expect, it } from 'vitest';

import {
  buildCharacterSheet,
  mergePartyMembers,
  type PartyMemberSource,
} from '../overhaul/useOverhaulViewModel';

import type { Character } from '@/types/character';
import type { SessionCompanion } from '@/webmcp/companion-api';

describe('game-session character sheet view model', () => {
  it('uses stored current/max HP instead of preview math', () => {
    const character = {
      id: 'char-stored-hp',
      name: 'The Apprentice',
      level: 5,
      race: {
        name: 'Human',
        speed: 30,
        traits: [],
        languages: [],
      },
      class: {
        name: 'Barbarian',
        hitDie: 12,
      },
      abilityScores: {
        strength: { score: 10, modifier: 0, savingThrow: false },
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 16, modifier: 3, savingThrow: false },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 10, modifier: 0, savingThrow: false },
        charisma: { score: 10, modifier: 0, savingThrow: false },
      },
      character_stats: {
        current_hit_points: 7,
        max_hit_points: 20,
      },
    } as unknown as Character;

    const sheet = buildCharacterSheet(character);

    // Preview math would produce 55 for this level-5 Barbarian.
    expect(sheet.hpCurrent).toBe(7);
    expect(sheet.hpMax).toBe(20);
  });

  it('adapts stored spell groups, slots, and spellcasting stats for the sheet', () => {
    const character = {
      id: 'scholar-stored-spells',
      name: 'The Scholar',
      level: 3,
      race: { name: 'Human', speed: 30, traits: [], languages: [] },
      class: { name: 'Wizard', hitDie: 6 },
      abilityScores: {
        strength: { score: 10, modifier: 0, savingThrow: false },
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 12, modifier: 1, savingThrow: false },
        intelligence: { score: 18, modifier: 4, savingThrow: false },
        wisdom: { score: 10, modifier: 0, savingThrow: false },
        charisma: { score: 10, modifier: 0, savingThrow: false },
      },
      cantrips: ['fire-bolt', 'mage-hand', 'light'],
      knownSpells: [
        'magic-missile',
        'shield',
        'detect-magic',
        'identify',
        'find-familiar',
        'misty-step',
      ],
      preparedSpells: ['magic-missile', 'shield', 'detect-magic', 'identify', 'find-familiar'],
      spellSlots: {
        1: { max: 4, current: 4 },
        2: { max: 2, current: 1 },
      },
    } as unknown as Character;

    const sheet = buildCharacterSheet(character);

    expect(sheet.spells.cantrips).toHaveLength(3);
    expect(sheet.spells.known).toHaveLength(6);
    expect(sheet.spells.prepared).toHaveLength(5);
    expect(sheet.spellcasting).toMatchObject({
      ability: 'INT',
      spellAttackBonus: 6,
      spellSaveDC: 14,
      canPrepare: true,
      slots: [
        { level: 1, current: 4, max: 4 },
        { level: 2, current: 1, max: 2 },
      ],
    });
    expect(sheet.spells.known.find((spell) => spell.id === 'misty-step')?.isPrepared).toBe(false);
  });
});

describe('game-session party view model', () => {
  const protagonist: PartyMemberSource = {
    characterId: 'hero-character',
    member: {
      id: 'hero-character',
      name: 'Aria',
      subtitle: 'Level 5 Wizard',
      currentHp: 18,
      maxHp: 24,
      avatarUrl: 'https://example.com/aria.png',
    },
  };
  const companion: SessionCompanion = {
    id: 'companion-row',
    characterId: 'companion-character',
    name: 'Mira',
    class: 'Cleric',
    level: 4,
    portraitUrl: 'https://example.com/mira.png',
    controller: 'webmcp',
  };

  it('shows the protagonist and active companions outside combat', () => {
    expect(mergePartyMembers(protagonist, [companion], [])).toEqual([
      protagonist.member,
      {
        id: 'companion-row',
        name: 'Mira',
        subtitle: 'Level 4 Cleric',
        currentHp: null,
        maxHp: null,
        avatarUrl: 'https://example.com/mira.png',
      },
    ]);
  });

  it('deduplicates protagonist and companion encounter participants by characterId', () => {
    const party = mergePartyMembers(
      protagonist,
      [companion],
      [
        {
          id: 'hero-participant',
          characterId: 'hero-character',
          name: 'Aria in combat',
          characterClass: 'Wizard',
          level: 5,
          currentHitPoints: 17,
          maxHitPoints: 24,
          portraitUrl: 'https://example.com/aria-combat.png',
        },
        {
          id: 'companion-participant',
          characterId: 'companion-character',
          name: 'Mira in combat',
          characterClass: 'Cleric',
          level: 4,
          currentHitPoints: 12,
          maxHitPoints: 18,
        },
        {
          id: 'second-player-participant',
          characterId: 'second-player-character',
          name: 'Rook',
          characterClass: 'Ranger',
          level: 3,
          currentHitPoints: 11,
          maxHitPoints: 16,
        },
      ],
    );

    expect(party.map((member) => member.id)).toEqual([
      'hero-character',
      'companion-row',
      'second-player-participant',
    ]);
    expect(party[1]).toMatchObject({
      id: 'companion-row',
      name: 'Mira in combat',
      currentHp: 12,
      maxHp: 18,
    });
    expect(party[2]).toEqual({
      id: 'second-player-participant',
      name: 'Rook',
      subtitle: 'Level 3 Ranger',
      currentHp: 11,
      maxHp: 16,
      avatarUrl: undefined,
    });
  });

  it('renders all six saving throws with proficiency bonuses even when ability modifiers are missing (#2343 C7)', () => {
    const character = {
      id: 'apprentice-partial-abilities',
      name: 'The Apprentice',
      level: 5,
      race: { name: 'Human', speed: 30, traits: [], languages: [] },
      class: { name: 'Barbarian', hitDie: 12 },
      abilityScores: {
        strength: { score: 10 },
        dexterity: { score: 14 },
        constitution: { score: 16 },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 10, modifier: 0, savingThrow: false },
        charisma: { score: 10, modifier: 0, savingThrow: false },
      },
      character_stats: { current_hit_points: 7, max_hit_points: 20 },
    } as unknown as Character;

    const sheet = buildCharacterSheet(character);

    expect(sheet.savingThrows.map((s) => s.label)).toEqual([
      'STR',
      'DEX',
      'CON',
      'INT',
      'WIS',
      'CHA',
    ]);
    for (const save of sheet.savingThrows) {
      expect(save.modifier).toMatch(/^[+-]\d+$/);
    }
    // A level-5 Barbarian is proficient in STR and CON saves (PB +3), so the
    // missing modifiers are derived from the scores and the bonus is added.
    expect(Object.fromEntries(sheet.savingThrows.map((s) => [s.label, s.modifier]))).toEqual({
      STR: '+3',
      DEX: '+2',
      CON: '+6',
      INT: '+0',
      WIS: '+0',
      CHA: '+0',
    });
  });

  it('leaves a non-proficient save at its plain ability modifier (#2343 C7)', () => {
    const character = {
      id: 'wizard-no-modifiers',
      name: 'The Novice',
      level: 3,
      race: { name: 'Human', speed: 30, traits: [], languages: [] },
      class: { name: 'Wizard', hitDie: 6 },
      abilityScores: {
        strength: { score: 8 },
        dexterity: { score: 14 },
        constitution: { score: 12 },
        intelligence: { score: 16 },
        wisdom: { score: 10 },
        charisma: { score: 10 },
      },
      character_stats: { current_hit_points: 5, max_hit_points: 14 },
    } as unknown as Character;

    const sheet = buildCharacterSheet(character);
    const saves = Object.fromEntries(sheet.savingThrows.map((s) => [s.label, s.modifier]));

    // A level-3 Wizard is proficient in INT and WIS saves (PB +2). The
    // non-proficient STR save stays at its plain modifier.
    expect(saves['STR']).toBe('-1');
    expect(saves['DEX']).toBe('+2');
    expect(saves['INT']).toBe('+5');
    expect(saves['WIS']).toBe('+2');
  });
});

describe('sheet weapon attack bonuses with a name-only class (#2519)', () => {
  // The game-session loader gives the sheet a class that is only { name } — no
  // weaponProficiencies list — so proficiency must still resolve from the SRD class.
  const scholar = {
    id: 'scholar-name-only-class',
    name: 'The Scholar',
    level: 1,
    race: { name: 'Human', speed: 30, traits: [], languages: [] },
    class: { name: 'Wizard', hitDie: 6 },
    abilityScores: {
      strength: { score: 8, modifier: -1, savingThrow: false },
      dexterity: { score: 12, modifier: 1, savingThrow: false },
      constitution: { score: 12, modifier: 1, savingThrow: false },
      intelligence: { score: 18, modifier: 4, savingThrow: false },
      wisdom: { score: 14, modifier: 2, savingThrow: false },
      charisma: { score: 10, modifier: 0, savingThrow: false },
    },
    inventory: [
      { itemId: 'quarterstaff', quantity: 1, equipped: true },
      { itemId: 'longsword', quantity: 1, equipped: true },
    ],
    character_stats: { current_hit_points: 7, max_hit_points: 7 },
  } as unknown as Character;

  it('adds proficiency for a Wizard quarterstaff and withholds it for a longsword', () => {
    const sheet = buildCharacterSheet(scholar);

    expect(sheet.attacks).toEqual([
      expect.objectContaining({ name: 'Quarterstaff', bonus: '+1' }),
      expect.objectContaining({ name: 'Longsword', bonus: '-1' }),
    ]);
  });

  it('adds proficiency for a weapon the subrace data carries (High Elf longsword)', () => {
    // The character data can carry weapon training the class list lacks; the sheet
    // honors it. The engine does not read subrace proficiencies yet — the follow-up
    // filed from #2519 covers teaching it the same data.
    const elfScholar = {
      ...scholar,
      subrace: { name: 'High Elf', weaponProficiencies: ['Longswords'] },
    } as unknown as Character;
    const sheet = buildCharacterSheet(elfScholar);

    expect(sheet.attacks).toEqual([
      expect.objectContaining({ name: 'Quarterstaff', bonus: '+1' }),
      expect.objectContaining({ name: 'Longsword', bonus: '+1' }),
    ]);
  });
});
