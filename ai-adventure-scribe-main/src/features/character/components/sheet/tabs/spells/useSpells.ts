import { useState, useEffect, useCallback, useMemo } from 'react';

import type { AbilityScores, Character } from '@/types/character';
import type { CharacterSpellDisplay } from '@/utils/spell-lookup';

import logger from '@/lib/logger';
import { characterSpellService } from '@/services/characterSpellApi';
import { applyRestResultToCharacter, restApi } from '@/services/rest-api';
import { calculateProficiencyBonus } from '@/utils/character/basic-math';
import { getCharacterSpells } from '@/utils/spell-lookup';
import { getSpellcastingInfo } from '@/utils/spell-validation/spellcasting-info';

export interface SpellSlots {
  [key: number]: { total: number; used: number };
}

export interface UseSpellsReturn {
  spells: CharacterSpellDisplay[];
  loading: boolean;
  error: string | null;
  /** Long-rest in-flight flag and failure message. Separate from the page-level
   * loading/error so a failed rest never swaps the tabs for an error screen. */
  resting: boolean;
  restError: string | null;
  spellSlots: SpellSlots;
  /** Null for non-casters (Fighter, no class, class without spellcasting info)
   * — the tab shows a non-caster state instead of fake Intelligence numbers. */
  spellcastingAbility: keyof AbilityScores | null;
  spellcastingMod: number | null;
  proficiencyBonus: number;
  spellAttackBonus: number | null;
  spellSaveDC: number | null;
  cantrips: CharacterSpellDisplay[];
  leveledSpells: CharacterSpellDisplay[];
  longRest: () => Promise<void>;
}

/**
 * Convert the character's stored spell slots ({ max, current } per level,
 * as produced by loadCharacterWithSpells from the characters table) into the
 * tab's { total, used } display shape.
 */
export function toTabSpellSlots(slots: Character['spellSlots']): SpellSlots {
  if (!slots) return {};
  return Object.fromEntries(
    Object.entries(slots).map(([level, slot]) => [
      Number(level),
      { total: slot.max, used: Math.max(0, slot.max - slot.current) },
    ]),
  );
}

/**
 * Resolve the character's spellcasting ability from their class.
 * Returns null for non-casters (Fighter, no class, or a class that carries no
 * spellcasting info) — the tab shows a non-caster state instead of falling back
 * to Intelligence and displaying a DC/attack bonus as if real.
 */
export function resolveSpellcastingAbility(
  character: Character,
): keyof AbilityScores | null {
  if (character.class) {
    const info = getSpellcastingInfo(character.class, character.level ?? 1);
    if (info?.spellcastingAbility) return info.spellcastingAbility;
  }
  return null;
}

/**
 * Hook for managing spell data and spell slots
 * Extracted from SpellsTab.tsx
 */
export const useSpells = (character: Character, onUpdate?: () => void): UseSpellsReturn => {
  // State for spell data
  const [spells, setSpells] = useState<CharacterSpellDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Long-rest state is separate from the page-level loading/error: a failed
  // rest shows an inline error in the slots section, and a successful one
  // never unmounts the tabs.
  const [resting, setResting] = useState(false);
  const [restError, setRestError] = useState<string | null>(null);

  // Spell slots come from the character record (loaded from the characters
  // table), not hardcoded demo data. The grid reflects the character's real
  // slots; a long rest refills them through the shared rest API.
  const [spellSlots, setSpellSlots] = useState<SpellSlots>(() =>
    toTabSpellSlots(character.spellSlots),
  );

  // Keep the grid in sync when the character record changes (e.g. after the
  // parent sheet reloads the character following a rest elsewhere).
  useEffect(() => {
    setSpellSlots(toTabSpellSlots(character.spellSlots));
  }, [character.spellSlots]);

  // Load character spells from character data with optional API enhancement
  useEffect(() => {
    const loadSpells = async (): Promise<void> => {
      logger.debug('🎯 [useSpells] Loading spells for character:', character?.name || 'Unknown');

      setError(null);

      if (!character) return;

      // Primary: Use character data directly
      const characterSpellData = getCharacterSpells(character);
      const primarySpells = characterSpellData.allSpells;

      // Set primary data immediately
      setSpells(primarySpells);

      // Optional: Try to enhance with API data (non-blocking)
      if (character?.id && characterSpellService.isEnabled()) {
        try {
          setLoading(true);
          const apiSpellData = await characterSpellService.getCharacterSpells(character.id);
          const apiSpells = [...apiSpellData.cantrips, ...apiSpellData.spells];

          if (apiSpells.length > 0) {
            logger.info('🔮 [useSpells] Enhanced with API data:', {
              apiSpellCount: apiSpells.length,
              primarySpellCount: primarySpells.length,
            });

            // Merge API data with character data
            const enhancedSpells = apiSpells.map((apiSpell) => ({
              ...apiSpell,
              castingTime: apiSpell.casting_time,
              range: apiSpell.range_text,
              verbal: apiSpell.components_verbal,
              somatic: apiSpell.components_somatic,
              material: apiSpell.components_material,
              materialDescription: apiSpell.material_components,
            })) as CharacterSpellDisplay[];

            setSpells(enhancedSpells);
          }
        } catch (err) {
          logger.warn('🚫 [useSpells] API enhancement failed, using character data:', err);
        } finally {
          setLoading(false);
        }
      }
    };

    loadSpells();
  }, [
    character?.id,
    character?.cantrips,
    character?.knownSpells,
    character?.preparedSpells,
    character?.ritualSpells,
  ]);

  // Spellcasting ability comes from the character's class, not a hardcoded
  // 'intelligence'. A Cleric uses Wisdom, a Sorcerer Charisma, etc. Non-casters
  // get null — no DC, attack or slot grid is shown for them.
  const spellcastingAbility = useMemo(() => resolveSpellcastingAbility(character), [character]);
  const spellcastingMod = useMemo(
    () =>
      spellcastingAbility == null
        ? null
        : character.abilityScores?.[spellcastingAbility]?.modifier || 0,
    [character.abilityScores, spellcastingAbility],
  );
  const proficiencyBonus = useMemo(
    () => calculateProficiencyBonus(character.level || 1),
    [character.level],
  );
  const spellAttackBonus = useMemo(
    () => (spellcastingMod == null ? null : spellcastingMod + proficiencyBonus),
    [spellcastingMod, proficiencyBonus],
  );
  const spellSaveDC = useMemo(
    () => (spellcastingMod == null ? null : 8 + spellcastingMod + proficiencyBonus),
    [spellcastingMod, proficiencyBonus],
  );

  // Slot pips are read-only: the engine's character_spell_slots table is the
  // single source of truth (#2598), and the grid already reflects it via the
  // character record. Clicking a pip used to flip local state that reverted on
  // reload — a second slot-usage store. Slot changes happen through the rest
  // path or the combat engine, then re-sync through character.spellSlots.

  // Long rest persists through the shared rest API (the same endpoint the
  // sheet's rest button uses), then refills the grid from the persisted
  // result. It is not a local-only reset.
  const longRest = useCallback(async () => {
    if (!character.id) return;
    setResting(true);
    setRestError(null);
    try {
      const result = await restApi.longRest(character.id);
      const updated = applyRestResultToCharacter(character, result);
      setSpellSlots(toTabSpellSlots(updated.spellSlots));
      onUpdate?.();
    } catch (err) {
      logger.warn('🚫 [useSpells] Long rest failed:', err);
      setRestError(err instanceof Error ? err.message : 'Long rest failed');
    } finally {
      setResting(false);
    }
  }, [character, onUpdate]);

  const cantrips = useMemo(() => spells.filter((spell) => spell.level === 0), [spells]);
  const leveledSpells = useMemo(() => spells.filter((spell) => spell.level > 0), [spells]);

  return {
    spells,
    loading,
    error,
    resting,
    restError,
    spellSlots,
    spellcastingAbility,
    spellcastingMod,
    proficiencyBonus,
    spellAttackBonus,
    spellSaveDC,
    cantrips,
    leveledSpells,
    longRest,
  };
};
