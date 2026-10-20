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

  it('derives the Conditions panel from the engine-mirrored vital state (#261 CB-026)', () => {
    const base = {
      id: 'char-dying',
      name: 'The Scholar',
      level: 1,
      race: { name: 'Tiefling', speed: 30, traits: [], languages: [] },
      class: { name: 'Sorcerer', hitDie: 6 },
      abilityScores: {
        strength: { score: 8, modifier: -1, savingThrow: false },
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 12, modifier: 1, savingThrow: false },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 10, modifier: 0, savingThrow: false },
        charisma: { score: 16, modifier: 3, savingThrow: true },
      },
    } as unknown as Character;

    const dying = buildCharacterSheet({
      ...base,
      character_stats: { current_hit_points: 0, max_hit_points: 8, vital_state: 'dying' },
    } as unknown as Character);
    expect(dying.conditions.map((c) => c.name)).toContain('Unconscious (dying)');

    const stable = buildCharacterSheet({
      ...base,
      character_stats: { current_hit_points: 0, max_hit_points: 8, vital_state: 'stabilized' },
    } as unknown as Character);
    expect(stable.conditions.map((c) => c.name)).toContain('Unconscious (stable)');

    const dead = buildCharacterSheet({
      ...base,
      character_stats: { current_hit_points: 0, max_hit_points: 8, vital_state: 'dead' },
    } as unknown as Character);
    expect(dead.conditions.map((c) => c.name)).toContain('Dead');

    // A standing character with no stored conditions shows none: no invented entries.
    const standing = buildCharacterSheet({
      ...base,
      character_stats: { current_hit_points: 8, max_hit_points: 8, vital_state: 'standing' },
    } as unknown as Character);
    expect(standing.conditions).toEqual([]);
  });

  it('falls back to Unconscious (dying) at 0 HP when vital_state is missing (RG-018)', () => {
    const base = {
      id: 'char-no-vital',
      name: 'The Scholar',
      level: 1,
      race: { name: 'Tiefling', speed: 30, traits: [], languages: [] },
      class: { name: 'Sorcerer', hitDie: 6 },
      abilityScores: {
        strength: { score: 8, modifier: -1, savingThrow: false },
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 12, modifier: 1, savingThrow: false },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 10, modifier: 0, savingThrow: false },
        charisma: { score: 16, modifier: 3, savingThrow: true },
      },
    } as unknown as Character;

    // The engine mirror has not written vital_state yet: 0 HP still means unconscious.
    const missing = buildCharacterSheet({
      ...base,
      character_stats: { current_hit_points: 0, max_hit_points: 8 },
    } as unknown as Character);
    expect(missing.conditions.map((c) => c.name)).toContain('Unconscious (dying)');

    // Above 0 HP but below max with no vital_state: wounded, not "None"
    // (#261 remainder — Hark night 10-13: the old "no invented conditions"
    // expectation predates the wounded defect being pinned).
    const hurt = buildCharacterSheet({
      ...base,
      character_stats: { current_hit_points: 5, max_hit_points: 8 },
    } as unknown as Character);
    expect(hurt.conditions.map((c) => c.name)).toContain('Wounded');
  });

  it('shows Wounded instead of None when below max HP (#261 remainder)', () => {
    const base = {
      id: 'char-wounded',
      name: 'The Scholar',
      level: 1,
      race: { name: 'Tiefling', speed: 30, traits: [], languages: [] },
      class: { name: 'Sorcerer', hitDie: 6 },
      abilityScores: {
        strength: { score: 8, modifier: -1, savingThrow: false },
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 12, modifier: 1, savingThrow: false },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 10, modifier: 0, savingThrow: false },
        charisma: { score: 16, modifier: 3, savingThrow: true },
      },
    } as unknown as Character;

    // Hark N2-025: 11/14 with no vital_state on the mirror.
    const woundedNoMirror = buildCharacterSheet({
      ...base,
      character_stats: { current_hit_points: 11, max_hit_points: 14 },
    } as unknown as Character);
    expect(woundedNoMirror.conditions.map((c) => c.name)).toContain('Wounded');

    // Hark N2-037: 4/7 with vital_state 'standing'.
    const woundedStanding = buildCharacterSheet({
      ...base,
      character_stats: { current_hit_points: 4, max_hit_points: 7, vital_state: 'standing' },
    } as unknown as Character);
    expect(woundedStanding.conditions.map((c) => c.name)).toContain('Wounded');

    // Full HP: still no invented conditions.
    const full = buildCharacterSheet({
      ...base,
      character_stats: { current_hit_points: 8, max_hit_points: 8, vital_state: 'standing' },
    } as unknown as Character);
    expect(full.conditions).toEqual([]);
  });

  it('prefers the live encounter vital state over a stale character_stats mirror (#261 remainder)', () => {
    const base = {
      id: 'char-stale-mirror',
      name: 'The Scholar',
      level: 1,
      race: { name: 'Tiefling', speed: 30, traits: [], languages: [] },
      class: { name: 'Sorcerer', hitDie: 6 },
      abilityScores: {
        strength: { score: 8, modifier: -1, savingThrow: false },
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 12, modifier: 1, savingThrow: false },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 10, modifier: 0, savingThrow: false },
        charisma: { score: 16, modifier: 3, savingThrow: true },
      },
    } as unknown as Character;

    // Hark N2-037: the mirror still says "dying" after the killing blow, but the
    // encounter participant flags (server-stamped every combat sync) say dead.
    const deadLive = buildCharacterSheet(
      {
        ...base,
        character_stats: { current_hit_points: 0, max_hit_points: 8, vital_state: 'dying' },
      } as unknown as Character,
      'dead',
    );
    expect(deadLive.conditions.map((c) => c.name)).toContain('Dead');
    expect(deadLive.conditions.map((c) => c.name)).not.toContain('Unconscious (dying)');

    // Live "dying" wins over a mirror that has not been written yet.
    const dyingLive = buildCharacterSheet(
      {
        ...base,
        character_stats: { current_hit_points: 0, max_hit_points: 8 },
      } as unknown as Character,
      'dying',
    );
    expect(dyingLive.conditions.map((c) => c.name)).toContain('Unconscious (dying)');

    // Live "standing" clears a stale "dying" mirror; HP below max still reads Wounded.
    const healedLive = buildCharacterSheet(
      {
        ...base,
        character_stats: { current_hit_points: 5, max_hit_points: 8, vital_state: 'dying' },
      } as unknown as Character,
      'standing',
    );
    expect(healedLive.conditions.map((c) => c.name)).toContain('Wounded');
    expect(healedLive.conditions.map((c) => c.name)).not.toContain('Unconscious (dying)');

    // Live "stabilized" maps to Unconscious (stable).
    const stableLive = buildCharacterSheet(
      {
        ...base,
        character_stats: { current_hit_points: 0, max_hit_points: 8 },
      } as unknown as Character,
      'stabilized',
    );
    expect(stableLive.conditions.map((c) => c.name)).toContain('Unconscious (stable)');
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
    // The character data can carry weapon training the class list lacks. The engine reads the
    // subrace too now (#2540): both sides read shared/weapon-proficiency.ts, which adds the SRD
    // High Elf training (longswords, shortbows, longbows, shortswords) on top of the class list.
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

  it('maps server-side concentration to the sheet indicator (#709)', () => {
    const concentrating = {
      id: 'char-conc',
      name: 'The Apprentice',
      level: 5,
      concentration: { spellName: 'Dancing Lights', spellId: 'dancing-lights' },
    } as unknown as Character;

    expect(buildCharacterSheet(concentrating).concentratingOn).toBe('Dancing Lights');
    expect(buildCharacterSheet({ ...concentrating, concentration: null }).concentratingOn).toBeNull();
    expect(buildCharacterSheet({ ...concentrating, concentration: undefined }).concentratingOn).toBeNull();
  });
});
