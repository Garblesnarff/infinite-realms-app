/**
 * #571: after a party defeat the character sheet Inventory is empty.
 *
 * Pins that a defeated hero's inventory and equipment still reach the sheet. The
 * defeated state must not make buildCharacterSheet fall through to its
 * identity-only fallback (which returns inventory: []).
 *
 * Producers:
 * - the character record follows `mapCharacterToApi` (server-bun/src/routes/v1/characters.ts),
 *   with the stats row under `character_stats` the way `normalizeCharacter` puts it;
 * - the equipment rows follow the /v1/characters/:id/equipment shape (Issue1784EquipmentRow,
 *   every column), as in premade-gear-on-sheet.test.tsx.
 * - the encounter is the server's getCombatState payload (shared/test-fixtures/dying-participant-wire,
 *   pinned to the producer) run through the client's real mapAuthoritativeCombat.
 * The loader and the view model are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../../../../shared/test-fixtures/dying-participant-wire';

import type { Issue1784EquipmentRow } from '@/services/issue-1784-api';
import type { CombatEncounter } from '@/types/combat-encounter';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { buildCharacterSheet } from '@/features/game-session/components/game/overhaul/useOverhaulViewModel';
import { loadCharacterWithSpells } from '@/services/load-character-with-spells';

const { getCharacter, getCharacterEquipment } = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  getCharacterEquipment: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({ userDataApi: { getCharacter } }));
vi.mock('@/services/issue-1784-api', () => ({ issue1784Api: { getCharacterEquipment } }));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    getCharacterSpells: vi.fn().mockResolvedValue({ cantrips: [], spells: [] }),
  },
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const CHARACTER_ID = 'character-571';

function persistedEquipmentRow(
  record: { item_name: string; item_type: string; quantity: number; equipped: boolean },
  index: number,
): Issue1784EquipmentRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    character_id: CHARACTER_ID,
    item_name: record.item_name,
    item_type: record.item_type,
    quantity: record.quantity,
    equipped: record.equipped,
    is_magic: false,
    magic_bonus: 0,
    magic_properties: null,
    requires_attunement: false,
    is_attuned: false,
    attunement_requirements: null,
    magic_item_type: null,
    magic_item_rarity: 'common',
    magic_effects: null,
  };
}

function persistedCharacter(): Record<string, unknown> {
  return {
    id: CHARACTER_ID,
    user_id: 'user-571',
    name: 'Fallen Hero',
    race: 'Human',
    class: 'Fighter',
    level: 1,
    background: 'Soldier',
    skill_proficiencies: '',
    languages: [],
    cantrips: '',
    known_spells: '',
    prepared_spells: '',
    ritual_spells: '',
    experience_points: 0,
    // The `stats` object of mapCharacterToApi, every column it returns, under
    // `character_stats` the way normalizeCharacter puts it. A party defeat that killed
    // the hero leaves current_hit_points 0 and vital_state 'dead' (#2517).
    character_stats: [
      {
        id: 'stats-571',
        character_id: CHARACTER_ID,
        strength: 14,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        armor_class: 16,
        max_hit_points: 12,
        current_hit_points: 0,
        temporary_hit_points: 0,
        vital_state: 'dead',
        died_at: '2026-11-14T03:00:00.000Z',
        initiative_bonus: 0,
        speed: 30,
        created_at: '2026-11-14T02:00:00.000Z',
        updated_at: '2026-11-14T03:00:00.000Z',
      },
    ],
  };
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`missing ${what}`);
  return value;
}

/**
 * The encounter as the client holds it after the defeat: the server's `getCombatState` payload
 * (DYING_SCHOLAR_*, pinned to the producer by dying-and-death.real-db.test.ts) moved to the end
 * state of a party defeat (three failures, dead, encounter completed as party_defeated), run
 * through the client's real mapper `mapAuthoritativeCombat`.
 */
function defeatedEncounter(): CombatEncounter {
  return mapAuthoritativeCombat({
    encounter: {
      ...DYING_SCHOLAR_ENCOUNTER,
      status: 'completed',
      endedReason: 'party_defeated',
    },
    participants: [
      {
        ...DYING_SCHOLAR_PARTICIPANT,
        characterId: CHARACTER_ID,
        name: 'Fallen Hero',
        maxHp: 12,
        vitalState: 'dead',
        status: { ...DYING_SCHOLAR_PARTICIPANT.status, maxHp: 12, deathSavesFailures: 3 },
      },
    ],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('#571 defeated hero keeps inventory', () => {
  it('#571: buildCharacterSheet keeps inventory for a defeated hero', async () => {
    getCharacter.mockResolvedValue(persistedCharacter());
    getCharacterEquipment.mockResolvedValue([
      persistedEquipmentRow(
        { item_name: 'Longsword', item_type: 'weapon', quantity: 1, equipped: true },
        0,
      ),
      persistedEquipmentRow(
        { item_name: 'Backpack', item_type: 'equipment', quantity: 1, equipped: false },
        1,
      ),
      persistedEquipmentRow(
        { item_name: 'Rations', item_type: 'equipment', quantity: 5, equipped: false },
        2,
      ),
    ]);

    const character = required(await loadCharacterWithSpells(CHARACTER_ID), 'loaded character');
    const sheet = buildCharacterSheet(character, 'dead');

    expect(sheet.name).toBe('Fallen Hero');
    expect(sheet.hpCurrent).toBe(0);
    expect(sheet.equipment.map((item) => item.name)).toContain('Longsword');
    expect(sheet.inventory.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Backpack', 'Rations']),
    );
    const rations = sheet.inventory.find((item) => item.name === 'Rations');
    expect(rations?.quantity).toBe(5);
    expect(sheet.gearUnavailable).toBeFalsy();
  });

  it('#571: buildCharacterSheet keeps inventory with a completed party_defeated encounter', async () => {
    getCharacter.mockResolvedValue(persistedCharacter());
    getCharacterEquipment.mockResolvedValue([
      persistedEquipmentRow(
        { item_name: 'Longsword', item_type: 'weapon', quantity: 1, equipped: true },
        0,
      ),
      persistedEquipmentRow(
        { item_name: 'Backpack', item_type: 'equipment', quantity: 1, equipped: false },
        1,
      ),
      persistedEquipmentRow(
        { item_name: 'Rations', item_type: 'equipment', quantity: 5, equipped: false },
        2,
      ),
    ]);

    const character = required(await loadCharacterWithSpells(CHARACTER_ID), 'loaded character');
    const sheet = buildCharacterSheet(character, 'dead', defeatedEncounter());

    expect(sheet.name).toBe('Fallen Hero');
    expect(sheet.hpCurrent).toBe(0);
    expect(sheet.equipment.map((item) => item.name)).toContain('Longsword');
    expect(sheet.inventory.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Backpack', 'Rations']),
    );
    expect(sheet.gearUnavailable).toBeFalsy();
  });
});
