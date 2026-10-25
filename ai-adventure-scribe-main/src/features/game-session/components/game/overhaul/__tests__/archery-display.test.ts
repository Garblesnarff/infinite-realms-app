/**
 * #824 (reopened, queue 15:02Z Lane C): the in-session sheet ATTACKS list showed +5 for a
 * ranged weapon with Archery while the attack roll used +7 (Hark Sun 10-25 U-009, custom
 * Human Fighter, Archery, DEX +3, proficiency +2: crossbow roll 1d20+7, sheet longbow +5).
 * The session loader built the character field-by-field and dropped fightingStyles, so the
 * display function — fed by the same shared Archery rule as the roll — saw no style.
 * This drives the whole loader -> sheet path with the network mocked, like race-speed.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCharacterSheet } from '../useOverhaulViewModel';

import type { Character } from '@/types/character';

import { loadCharacterWithSpells } from '@/services/load-character-with-spells';

const {
  getCharacter,
  getCharacterEquipment,
  getCharacterSpells,
  getCharacterClassFeatures,
  getCharacterSubclass,
} = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  getCharacterEquipment: vi.fn(),
  getCharacterSpells: vi.fn(),
  getCharacterClassFeatures: vi.fn(),
  getCharacterSubclass: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({ userDataApi: { getCharacter } }));
vi.mock('@/services/issue-1784-api', () => ({ issue1784Api: { getCharacterEquipment } }));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: { getCharacterSpells },
}));
vi.mock('@/services/class-features-api', () => ({
  getCharacterClassFeatures,
  getCharacterSubclass,
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Hark U-009 shape: DEX +3 (score 16), STR +3 (score 16), proficiency +2 (level 1).
const abilityScores = {
  strength: 16,
  dexterity: 16,
  constitution: 14,
  intelligence: 10,
  wisdom: 12,
  charisma: 10,
};

function storedRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'character-id',
    user_id: 'user-1',
    name: 'Bram Holt',
    race: 'Human',
    class: 'Fighter',
    level: 1,
    fighting_styles: ['Archery'],
    cantrips: '',
    known_spells: '',
    prepared_spells: '',
    ritual_spells: '',
    character_stats: [abilityScores],
    ...overrides,
  };
}

const equipmentRows = [
  {
    id: 'eq-1',
    character_id: 'character-id',
    item_name: 'longbow',
    item_type: 'weapon',
    quantity: 1,
    equipped: true,
  },
  {
    id: 'eq-2',
    character_id: 'character-id',
    item_name: 'crossbow-light',
    item_type: 'weapon',
    quantity: 1,
    equipped: true,
  },
  {
    id: 'eq-3',
    character_id: 'character-id',
    item_name: 'longsword',
    item_type: 'weapon',
    quantity: 1,
    equipped: true,
  },
];

const fightingStyleRow = {
  id: 'feat-1',
  characterId: 'character-id',
  featureId: 'fighting-style',
  usesRemaining: null,
  isActive: true,
  acquiredAtLevel: 1,
  createdAt: '',
  feature: {
    id: 'feat-lib-1',
    className: 'Fighter',
    subclassName: null,
    featureName: 'Fighting Style',
    levelAcquired: 1,
    description: '',
    mechanicalEffects: null,
    usageType: null,
    usesPerRest: null,
    usesCount: null,
    createdAt: '',
  },
};

async function loadDriven(overrides: Record<string, unknown> = {}): Promise<Character> {
  getCharacter.mockResolvedValue(storedRow(overrides));
  const character = await loadCharacterWithSpells('character-id');
  if (!character) throw new Error('loader returned null');
  return character;
}

describe('#824 Archery on the in-session sheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCharacterEquipment.mockResolvedValue(equipmentRows);
    getCharacterSpells.mockResolvedValue({ cantrips: [], spells: [] });
    getCharacterClassFeatures.mockResolvedValue({
      features: [fightingStyleRow],
      usesRemaining: {},
    });
    getCharacterSubclass.mockResolvedValue(null);
  });

  it('the loader carries the fighting style from the record, canonicalized like the transformer', async () => {
    const character = await loadDriven();
    // Stored 'Archery' folds to the lowercase snake spelling the FIGHTING_STYLES
    // lookup is keyed by — same normalization as transformCharacterData.
    expect(character.fightingStyles).toEqual(['archery']);
  });

  it('the loader carries a JSON-string fighting style, like the transformer does', async () => {
    const character = await loadDriven({ fighting_styles: '["Archery"]' });
    expect(character.fightingStyles).toEqual(['archery']);
  });

  it('the loader canonicalizes several styles and drops non-strings', async () => {
    const character = await loadDriven({
      fighting_styles: ['Archery', 'Great Weapon Fighting', 7, null],
    });
    expect(character.fightingStyles).toEqual(['archery', 'great_weapon_fighting']);
    const sheet = buildCharacterSheet(character);
    expect(sheet.features).toContain('Fighting Style: Archery, Great Weapon Fighting');
  });

  it('the sheet ATTACKS list shows the roll number for ranged weapons with Archery', async () => {
    const character = await loadDriven();
    const sheet = buildCharacterSheet(character);
    // Roll: DEX +3 + proficiency +2 + Archery +2 = +7. Melee control stays +5.
    expect(sheet.attacks.find((a) => a.id === 'longbow')?.bonus).toBe('+7');
    expect(sheet.attacks.find((a) => a.id === 'crossbow-light')?.bonus).toBe('+7');
    expect(sheet.attacks.find((a) => a.id === 'longsword')?.bonus).toBe('+5');
  });

  it('the feature line names the style', async () => {
    const character = await loadDriven();
    const sheet = buildCharacterSheet(character);
    expect(sheet.features).toContain('Fighting Style: Archery');
    expect(sheet.features).not.toContain('Fighting Style');
  });
});
