/**
 * #898: pins the proficiency round trip for the Hark D20 shapes.
 *
 * #995 extends the original three-case pin (#993) to the two remaining
 * #898 shapes: the Sorcerer (D20-011, whose CON/CHA saves showed not
 * proficient) and the Wizard (D20-013, whose Acolyte background Insight
 * was dropped). Same chain, same assertions — the Sorcerer's payload must
 * carry constitution,charisma, and the Wizard's saved skill set must be
 * the union of the class choices with the background's fixed Insight +
 * Religion.
 *
 * The D20 sweep (builds 43a2a4d7 / e8a0e324) found chosen skills, class
 * saves and expertise lost or wrong on the saved sheet: a Fighter read back
 * proficient only in Athletics + Intimidation (Intimidation never chosen),
 * a Warlock's WIS/CHA saves came back CON/CHA, a Rogue's Expertise showed
 * +0. Verified on main 5d93ef6b: the loss no longer reproduces at any hop —
 * the persisted-set reads landed with #1827 (the loader parses the four
 * columns and the sheet prefers them over the class fallback maps), the
 * canonical-key matching with #1847, and Hark's own N21 retest on ace6cf23
 * already saw the Rogue's saves and Expertise values right. This pin holds
 * the line for all three field families:
 *
 *   hop 1 — the wizard body carries the complete sets (this file), and
 *   hop 4 — the sheet-load transform + proficiency math turn the served
 *           strings back into the right modifiers (this file),
 * while the server real-DB suite (character-create-starting-package) pins
 * hops 2–3 (stored columns and the GET response) against the fixtures this
 * file writes to shared/test-fixtures/*-898-create-payload.json.
 *
 * Wizard Characters are built with ProficienciesSelection's own formula
 * over the real data records: fixedSkills = background + race skill
 * proficiencies, allSkills = fixed + class choices, expertise = the step's
 * picks, tools = class + background, savingThrowProficiencies = the class
 * record's own list. One modelling note: the Rogue's choice list includes
 * Stealth, as recorded for D20-010, although the step filters fixed skills
 * out of the choosable list (Stealth is already Criminal-fixed there) — the
 * step's dedupe produces the same saved union either way, and the union is
 * what this pin asserts. The payload chain is the exact one
 * useCharacterSave.saveCharacter runs (same as the #971 pin).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mapWizardEquipmentToInventory } from '../use-character-save';

import type { Character } from '@/types/character';

import { backgrounds } from '@/data/backgroundOptions';
import { fighter } from '@/data/classes/fighter';
import { rogue } from '@/data/classes/rogue';
import { sorcerer } from '@/data/classes/sorcerer';
import { warlock } from '@/data/classes/warlock';
import { wizard } from '@/data/classes/wizard';
import { getStartingEquipment } from '@/data/equipmentOptions';
import { halfOrc } from '@/data/races/half-orc';
import { human } from '@/data/races/human';
import { prepareCharacterPayload } from '@/services/user-data-payload-helpers';
import { transformCharacterForStorage } from '@/types/character';
import { transformCharacterData } from '@/utils/character/data-transformers';
import { calculateSavingThrowModifiers, calculateSkillModifiers } from '@/utils/character-proficiency-calculations';
import {
  transformAbilityScoresForStorage,
  transformEquipmentForStorage,
  transformMulticlassingForStorage,
} from '@/utils/characterTransformations';
import { applyRacialBonusesToAbilityScores } from '@/utils/racialAbilityBonuses';

const TEMP_ID = '00000000-0000-0000-0000-000000000000';

type Scores = Record<'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma', number>;

function abilityScores(base: Scores): Character['abilityScores'] {
  const entry = (score: number): { score: number; modifier: number; savingThrow: boolean } => ({
    score,
    modifier: Math.floor((score - 10) / 2),
    savingThrow: false,
  });
  return {
    strength: entry(base.strength),
    dexterity: entry(base.dexterity),
    constitution: entry(base.constitution),
    intelligence: entry(base.intelligence),
    wisdom: entry(base.wisdom),
    charisma: entry(base.charisma),
  };
}

interface CaseSpec {
  key: string;
  name: string;
  race: typeof human;
  subraceName?: string;
  charClass: typeof rogue;
  backgroundId: string;
  base: Scores;
  chosenSkills: string[];
  expertise: string[];
  expectedSkills: string[];
  expectedSaves: string[];
  expectedTools: string[];
  /** skill -> [modifier, proficient, expertise] */
  expectedSkillMods: Record<string, [number, boolean, boolean]>;
  /** ability -> [modifier, proficient] */
  expectedSaveMods: Record<string, [number, boolean]>;
}

const CASES: CaseSpec[] = [
  {
    key: 'rogue',
    name: 'Probe Rogue 898',
    race: human,
    subraceName: 'Standard Human',
    charClass: rogue,
    backgroundId: 'criminal',
    base: { strength: 8, dexterity: 15, constitution: 13, intelligence: 12, wisdom: 10, charisma: 14 },
    chosenSkills: ['Acrobatics', 'Insight', 'Perception', 'Stealth'],
    expertise: ['Insight', 'Stealth'],
    expectedSkills: ['Acrobatics', 'Deception', 'Insight', 'Perception', 'Stealth'],
    expectedSaves: ['dexterity', 'intelligence'],
    expectedTools: ["Thieves' tools", 'One type of gaming set'],
    // Human +1 all: STR9(-1) DEX16(+3) CON14(+2) INT13(+1) WIS11(0) CHA15(+2), pb +2
    expectedSkillMods: {
      Acrobatics: [5, true, false],
      Athletics: [-1, false, false],
      Deception: [4, true, false],
      Insight: [4, true, true],
      Perception: [2, true, false],
      'Sleight of Hand': [3, false, false],
      Stealth: [7, true, true],
    },
    expectedSaveMods: {
      strength: [-1, false],
      dexterity: [5, true],
      constitution: [2, false],
      intelligence: [3, true],
      wisdom: [0, false],
      charisma: [2, false],
    },
  },
  {
    key: 'fighter',
    name: 'Probe Fighter 898',
    race: halfOrc,
    charClass: fighter,
    backgroundId: 'acolyte',
    base: { strength: 15, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 13, charisma: 8 },
    chosenSkills: ['Athletics', 'Perception'],
    expertise: [],
    expectedSkills: ['Athletics', 'Insight', 'Intimidation', 'Perception', 'Religion'],
    expectedSaves: ['strength', 'constitution'],
    expectedTools: [],
    // Half-Orc STR+2 CON+1: STR17(+3) DEX12(+1) CON15(+2) INT10(0) WIS13(+1) CHA8(-1), pb +2
    expectedSkillMods: {
      Acrobatics: [1, false, false],
      Athletics: [5, true, false],
      Insight: [3, true, false],
      Intimidation: [1, true, false],
      Perception: [3, true, false],
      Religion: [2, true, false],
    },
    expectedSaveMods: {
      strength: [5, true],
      dexterity: [1, false],
      constitution: [4, true],
      intelligence: [0, false],
      wisdom: [1, false],
      charisma: [-1, false],
    },
  },
  {
    key: 'warlock',
    name: 'Probe Warlock 898',
    race: human,
    subraceName: 'Standard Human',
    charClass: warlock,
    backgroundId: 'acolyte',
    base: { strength: 8, dexterity: 13, constitution: 14, intelligence: 12, wisdom: 10, charisma: 15 },
    chosenSkills: ['Arcana', 'Deception'],
    expertise: [],
    expectedSkills: ['Arcana', 'Deception', 'Insight', 'Religion'],
    expectedSaves: ['wisdom', 'charisma'],
    expectedTools: [],
    // Human +1 all: STR9(-1) DEX14(+2) CON15(+2) INT13(+1) WIS11(0) CHA16(+3), pb +2
    expectedSkillMods: {
      Arcana: [3, true, false],
      Deception: [5, true, false],
      Insight: [2, true, false],
      Religion: [3, true, false],
      Stealth: [2, false, false],
    },
    expectedSaveMods: {
      strength: [-1, false],
      dexterity: [2, false],
      constitution: [2, false],
      intelligence: [1, false],
      wisdom: [2, true],
      charisma: [5, true],
    },
  },
  {
    key: 'sorcerer',
    name: 'Probe Sorcerer 898',
    race: human,
    subraceName: 'Standard Human',
    charClass: sorcerer,
    backgroundId: 'noble',
    base: { strength: 8, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 15 },
    chosenSkills: ['Arcana', 'Deception'],
    expertise: [],
    expectedSkills: ['Arcana', 'Deception', 'History', 'Persuasion'],
    expectedSaves: ['constitution', 'charisma'],
    expectedTools: ['One type of gaming set'],
    // Human +1 all: STR9(-1) DEX14(+2) CON15(+2) INT11(0) WIS13(+1) CHA16(+3), pb +2
    expectedSkillMods: {
      Arcana: [2, true, false],
      Deception: [5, true, false],
      History: [2, true, false],
      Persuasion: [5, true, false],
      Insight: [1, false, false],
      Stealth: [2, false, false],
    },
    expectedSaveMods: {
      strength: [-1, false],
      dexterity: [2, false],
      constitution: [4, true],
      intelligence: [0, false],
      wisdom: [1, false],
      charisma: [5, true],
    },
  },
  {
    key: 'wizard',
    name: 'Probe Wizard 898',
    race: human,
    subraceName: 'Standard Human',
    charClass: wizard,
    backgroundId: 'acolyte',
    base: { strength: 8, dexterity: 13, constitution: 12, intelligence: 15, wisdom: 14, charisma: 10 },
    chosenSkills: ['Arcana', 'Investigation'],
    expertise: [],
    expectedSkills: ['Arcana', 'Insight', 'Investigation', 'Religion'],
    expectedSaves: ['intelligence', 'wisdom'],
    expectedTools: [],
    // Human +1 all: STR9(-1) DEX14(+2) CON13(+1) INT16(+3) WIS15(+2) CHA11(0), pb +2
    expectedSkillMods: {
      Arcana: [5, true, false],
      Insight: [4, true, false],
      Investigation: [5, true, false],
      Religion: [5, true, false],
      Perception: [2, false, false],
      Stealth: [2, false, false],
    },
    expectedSaveMods: {
      strength: [-1, false],
      dexterity: [2, false],
      constitution: [1, false],
      intelligence: [5, true],
      wisdom: [4, true],
      charisma: [0, false],
    },
  },
];

/**
 * Builds the wizard Character with proficiencies computed by the formula
 * ProficienciesSelection.updateProficiencies dispatches (see the header
 * note on the Rogue's Stealth pick).
 */
function buildWizardCharacter(spec: CaseSpec): Character {
  const background = backgrounds.find((b) => b.id === spec.backgroundId);
  if (!background) throw new Error(`background ${spec.backgroundId} missing`);
  const fixedSkills = [
    ...new Set([...(background.skillProficiencies || []), ...(spec.race.skillProficiencies || [])]),
  ];
  const allSkills = [...new Set([...fixedSkills, ...spec.chosenSkills])];
  const fixedTools = [
    ...new Set([...(spec.charClass.toolProficiencies || []), ...(background.toolProficiencies || [])]),
  ];
  const fixedLanguages = [...new Set([...(spec.race.languages || []), ...(spec.charClass.languages || [])])];
  const packageNames = getStartingEquipment(spec.charClass.name).map((eq) => eq.name);
  const subrace = spec.subraceName
    ? spec.race.subraces?.find((s) => s.name === spec.subraceName)
    : undefined;
  if (spec.subraceName && !subrace) throw new Error(`subrace ${spec.subraceName} missing`);
  return {
    name: spec.name,
    race: spec.race,
    subrace: subrace ?? null,
    class: spec.charClass,
    background,
    level: 1,
    alignment: 'True Neutral',
    abilityScores: abilityScores(spec.base),
    equipment: [...background.equipment, ...packageNames],
    selectedEquipmentOptionIndex: 0,
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    languages: fixedLanguages,
    skillProficiencies: allSkills,
    expertiseProficiencies: spec.expertise,
    toolProficiencies: fixedTools,
    savingThrowProficiencies: [...(spec.charClass.savingThrowProficiencies || [])],
    classLevels: [
      { classId: spec.charClass.id, className: spec.charClass.name, level: 1, hitDie: spec.charClass.hitDie, features: [] },
    ],
  } as Character;
}

function buildCreatePayload(character: Character): Record<string, unknown> {
  const characterData = {
    ...transformCharacterForStorage({ ...character, campaign_id: null, user_id: 'test-user-898' }),
    ...transformMulticlassingForStorage(character),
  };
  if (!character.abilityScores) throw new Error('wizard character missing abilityScores');
  const finalAbilityScores = applyRacialBonusesToAbilityScores(
    character.abilityScores,
    character.race || null,
    character.subrace || null,
    character.racialAbilityChoices,
  );
  const statsData = transformAbilityScoresForStorage(finalAbilityScores, TEMP_ID);
  const equipmentData = transformEquipmentForStorage(
    { ...character, inventory: mapWizardEquipmentToInventory(character) },
    TEMP_ID,
  );
  return prepareCharacterPayload({
    ...characterData,
    stats: {
      strength: statsData.strength,
      dexterity: statsData.dexterity,
      constitution: statsData.constitution,
      intelligence: statsData.intelligence,
      wisdom: statsData.wisdom,
      charisma: statsData.charisma,
    },
    equipment: equipmentData,
  }) as Record<string, unknown>;
}

const sorted = (v: unknown): string[] =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();

describe('wizard create payload — skills, saves, expertise (#898)', () => {
  for (const spec of CASES) {
    it(`${spec.key}: payload carries the chosen skills, class saves and expertise`, () => {
      const payload = buildCreatePayload(buildWizardCharacter(spec));
      expect(sorted(payload.skill_proficiencies), 'skill_proficiencies').toEqual(
        [...spec.expectedSkills].sort(),
      );
      expect(sorted(payload.saving_throw_proficiencies), 'saving_throw_proficiencies').toEqual(
        [...spec.expectedSaves].sort(),
      );
      expect(sorted(payload.expertise_proficiencies), 'expertise_proficiencies').toEqual(
        [...spec.expertise].sort(),
      );
      expect(sorted(payload.tool_proficiencies), 'tool_proficiencies').toEqual(
        [...spec.expectedTools].sort(),
      );

      const fixturePath = resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../../../shared/test-fixtures/${spec.key}-898-create-payload.json`,
      );
      mkdirSync(dirname(fixturePath), { recursive: true });
      writeFileSync(fixturePath, `${JSON.stringify(payload, null, 2)}\n`);
    });

    it(`${spec.key}: sheet load transform + proficiency math reproduce every modifier`, () => {
      const character = buildWizardCharacter(spec);
      const payload = buildCreatePayload(character);
      if (!character.abilityScores) throw new Error('missing abilityScores');
      const finalScores = applyRacialBonusesToAbilityScores(
        character.abilityScores,
        character.race || null,
        character.subrace || null,
        character.racialAbilityChoices,
      );
      // The row as GET /v1/characters/:id serves it (mapCharacterToApi shape),
      // fed to transformCharacterData the way use-character-data does.
      const row = {
        id: 'probe-898',
        user_id: 'test-user-898',
        name: spec.name,
        race: payload.race,
        subrace: payload.subrace ?? null,
        class: payload.class,
        level: 1,
        background: payload.background,
        alignment: 'True Neutral',
        experience_points: 0,
        skill_proficiencies: payload.skill_proficiencies,
        expertise_proficiencies: payload.expertise_proficiencies,
        tool_proficiencies: payload.tool_proficiencies,
        saving_throw_proficiencies: payload.saving_throw_proficiencies,
        languages: payload.languages,
      } as Parameters<typeof transformCharacterData>[0];
      const statsRow = {
        strength: finalScores.strength.score,
        dexterity: finalScores.dexterity.score,
        constitution: finalScores.constitution.score,
        intelligence: finalScores.intelligence.score,
        wisdom: finalScores.wisdom.score,
        charisma: finalScores.charisma.score,
        armor_class: 12,
        max_hit_points: 10,
        current_hit_points: 10,
      } as Parameters<typeof transformCharacterData>[1];

      const loaded = transformCharacterData(row, statsRow, []);
      expect([...(loaded.skillProficiencies ?? [])].sort(), 'loaded skills').toEqual(
        [...spec.expectedSkills].sort(),
      );
      expect([...(loaded.savingThrowProficiencies ?? [])].sort(), 'loaded saves').toEqual(
        [...spec.expectedSaves].sort(),
      );
      expect([...(loaded.expertiseProficiencies ?? [])].sort(), 'loaded expertise').toEqual(
        [...spec.expertise].sort(),
      );
      expect([...(loaded.toolProficiencies ?? [])].sort(), 'loaded tools').toEqual(
        [...spec.expectedTools].sort(),
      );

      const skillMods = calculateSkillModifiers(loaded);
      for (const [skill, [modifier, proficient, expertise]] of Object.entries(spec.expectedSkillMods)) {
        expect(skillMods[skill], `skill ${skill}`).toEqual({ modifier, proficient, expertise });
      }
      const saveMods = calculateSavingThrowModifiers(loaded);
      for (const [ability, [modifier, proficient]] of Object.entries(spec.expectedSaveMods)) {
        expect(saveMods[ability], `save ${ability}`).toEqual({ modifier, proficient });
      }
    });
  }
});
