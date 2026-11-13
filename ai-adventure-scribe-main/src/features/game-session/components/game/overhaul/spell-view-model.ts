import { chooseSpellSlotLevel } from '../../../../../../shared/spell-slot-choice';
import { findSrdClass } from '../../../../../../shared/srd-class-data';

import type { SpellVM, SpellSlotVM, SpellcastingVM, SpellsVM } from './types';
import type { Character } from '@/types/character';
import type { CharacterStats } from '@/utils/character-calculations';

import { getAlwaysPreparedSpells } from '@/utils/character/subclass-grants';
import { getSpellById } from '@/utils/spell-lookup';

const canonicalSpellId = (id: string): string => getSpellById(id, false)?.id ?? id;

/** Dedupe by catalog id, but keep the first raw stored id so Prepare/Cast
 * still send the same string the character record uses. */
const uniqueSpellIds = (ids: readonly string[] | undefined): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids ?? []) {
    if (typeof id !== 'string' || id.length === 0) continue;
    const canonical = canonicalSpellId(id);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(id);
  }
  return result;
};

const prettifySpellId = (id: string): string =>
  id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim() || 'Unknown Spell';

const formatAbility = (ability: string): string => ability.slice(0, 3).toUpperCase();

const toSpell = (
  id: string,
  isPrepared: boolean,
  canPrepare: boolean,
  alwaysPreparedIds: ReadonlySet<string>,
): SpellVM => {
  const spell = getSpellById(id, false);
  const alwaysPrepared = alwaysPreparedIds.has(canonicalSpellId(id));

  return {
    id,
    name: spell?.name ?? prettifySpellId(id),
    level: spell?.level ?? null,
    school: spell?.school,
    castingTime: spell?.casting_time,
    range: spell?.range_text,
    components: spell?.components,
    description: spell?.description,
    ritual: spell?.ritual,
    concentration: spell?.concentration,
    isPrepared,
    canPrepare: alwaysPrepared ? false : canPrepare,
    alwaysPrepared,
  };
};

const toSpellSlots = (
  character: Character,
  calculatedSlots: CharacterStats['spellSlots'],
): SpellSlotVM[] => {
  const storedSlots = character.spellSlots;
  const slots = storedSlots && Object.keys(storedSlots).length > 0 ? storedSlots : undefined;

  if (slots) {
    return Object.entries(slots)
      .map(([level, slot]) => ({
        level: Number(level),
        current: slot.current,
        max: slot.max,
      }))
      .filter((slot) => Number.isInteger(slot.level) && slot.level > 0 && slot.max > 0)
      .sort((a, b) => a.level - b.level);
  }

  if (character.pactSlots && character.pactSlots.maximum > 0) {
    return [
      {
        level: character.pactSlots.level,
        current: character.pactSlots.current,
        max: character.pactSlots.maximum,
      },
    ];
  }

  return Object.entries(calculatedSlots ?? {})
    .map(([level, max]) => ({ level: Number(level), current: max, max }))
    .filter((slot) => Number.isInteger(slot.level) && slot.level > 0 && slot.max > 0)
    .sort((a, b) => a.level - b.level);
};

const canPrepareSpells = (character: Character): boolean => {
  const spellcasting = character.class?.spellcasting;
  const srdSpellcasting = findSrdClass(character.class?.name)?.spellcasting;

  return Boolean(
    spellcasting?.spellbook ||
    srdSpellcasting?.preparedSpellsFormula ||
    (spellcasting && spellcasting.spellsKnown == null && !srdSpellcasting?.knownSpellsByLevel),
  );
};

export function buildSpellsViewModel(
  character: Character,
  stats: Pick<
    CharacterStats,
    'spellAttackBonus' | 'spellSaveDC' | 'spellcastingAbility' | 'spellSlots'
  >,
): { spells: SpellsVM; spellcasting: SpellcastingVM | null } {
  const spellcastingAbility = stats.spellcastingAbility;
  const classCanCast = Boolean(spellcastingAbility);
  const canPrepare = classCanCast && canPrepareSpells(character);
  const hasSpellbook = Boolean(
    character.class?.spellcasting?.spellbook ||
    findSrdClass(character.class?.name)?.spellcasting?.knownSpellsFormula === 'wizard-spellbook',
  );
  const preparedIds = new Set(uniqueSpellIds(character.preparedSpells).map(canonicalSpellId));
  const cantripIds = uniqueSpellIds(character.cantrips);
  const knownIds = uniqueSpellIds([
    ...(character.knownSpells ?? []),
    ...(character.preparedSpells ?? []),
  ]);
  const preparedSpellIds = uniqueSpellIds(character.preparedSpells);
  const alwaysPreparedIds = new Set(
    getAlwaysPreparedSpells(character).map((name) => canonicalSpellId(name)),
  );

  const spells: SpellsVM = {
    cantrips: cantripIds.map((id) => toSpell(id, true, false, alwaysPreparedIds)),
    known: knownIds.map((id) =>
      toSpell(id, preparedIds.has(canonicalSpellId(id)), canPrepare, alwaysPreparedIds),
    ),
    prepared: preparedSpellIds.map((id) => toSpell(id, true, canPrepare, alwaysPreparedIds)),
  };

  return {
    spells,
    spellcasting: classCanCast
      ? {
          ability: formatAbility(spellcastingAbility as string),
          spellAttackBonus: stats.spellAttackBonus ?? null,
          spellSaveDC: stats.spellSaveDC ?? null,
          canPrepare,
          hasSpellbook,
          slots: toSpellSlots(character, stats.spellSlots),
        }
      : null,
  };
}

export function buildSpellCastContext(spell: Pick<SpellVM, 'id' | 'level'>): {
  intent: 'spell_cast';
  spellId: string;
  spellLevel: number | null;
} {
  return {
    intent: 'spell_cast',
    spellId: spell.id,
    spellLevel: spell.level,
  };
}

/**
 * The sheet's Cast message. Its tag's `spell_level` is the slot the cast spends, which the
 * dm-actions-handler carries into the engine action (#1058): with the sheet's slots, the lowest
 * remaining slot at or above the spell's level (#1227, the rule every player cast shares).
 */
export function buildSpellCastMessage(
  spell: Pick<SpellVM, 'name' | 'id' | 'level'>,
  slots?: ReadonlyArray<Pick<SpellSlotVM, 'level' | 'current'>> | null,
): string {
  const slotLevel =
    typeof spell.level === 'number' && spell.level > 0
      ? (chooseSpellSlotLevel(spell.level, {
          remaining: slots ? new Map(slots.map((slot) => [slot.level, slot.current])) : null,
        }) ?? spell.level)
      : spell.level;
  const level =
    slotLevel === 0 ? 'cantrip' : slotLevel == null ? 'unknown level' : `level ${slotLevel}`;
  return `I cast ${spell.name} [spell_id=${spell.id}, spell_level=${level}].`;
}
