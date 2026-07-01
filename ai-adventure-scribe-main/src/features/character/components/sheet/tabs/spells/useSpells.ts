import { useState, useEffect, useCallback, useMemo } from 'react';

import type { Character } from '@/types/character';
import type { CharacterSpellDisplay } from '@/utils/spell-lookup';

import logger from '@/lib/logger';
import { characterSpellService } from '@/services/characterSpellApi';
import { getCharacterSpells } from '@/utils/spell-lookup';

export interface SpellSlots {
  [key: number]: { total: number; used: number };
}

export interface UseSpellsReturn {
  spells: CharacterSpellDisplay[];
  loading: boolean;
  error: string | null;
  spellSlots: SpellSlots;
  spellcastingAbility: string;
  spellcastingMod: number;
  proficiencyBonus: number;
  spellAttackBonus: number;
  spellSaveDC: number;
  cantrips: CharacterSpellDisplay[];
  leveledSpells: CharacterSpellDisplay[];
  consumeSpellSlot: (level: number) => void;
  restoreSpellSlot: (level: number) => void;
  longRest: () => void;
}

/**
 * Hook for managing spell data and spell slots
 * Extracted from SpellsTab.tsx
 */
export const useSpells = (character: Character): UseSpellsReturn => {
  // State for spell data
  const [spells, setSpells] = useState<CharacterSpellDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Example spell slots for a caster (would be calculated based on class/level)
  const [spellSlots, setSpellSlots] = useState<SpellSlots>({
    1: { total: 4, used: 1 },
    2: { total: 3, used: 0 },
    3: { total: 3, used: 2 },
    4: { total: 1, used: 0 },
    5: { total: 1, used: 1 },
  });

  // Load character spells from character data with optional API enhancement
  useEffect(() => {
    const loadSpells = async () => {
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

  // Spellcasting ability (would be determined by class)
  const spellcastingAbility = 'intelligence'; // Example: Wizard
  const spellcastingMod = useMemo(() =>
    character.abilityScores?.[spellcastingAbility]?.modifier || 0,
    [character.abilityScores, spellcastingAbility]
  );
  const proficiencyBonus = useMemo(() =>
    Math.floor(((character.level || 1) - 1) / 4) + 2,
    [character.level]
  );
  const spellAttackBonus = useMemo(() =>
    spellcastingMod + proficiencyBonus,
    [spellcastingMod, proficiencyBonus]
  );
  const spellSaveDC = useMemo(() =>
    8 + spellcastingMod + proficiencyBonus,
    [spellcastingMod, proficiencyBonus]
  );

  const consumeSpellSlot = useCallback((level: number) => {
    setSpellSlots((prev) => {
      if (prev[level] && prev[level].used < prev[level].total) {
        return {
          ...prev,
          [level]: {
            ...prev[level],
            used: prev[level].used + 1,
          },
        };
      }
      return prev;
    });
  }, []);

  const restoreSpellSlot = useCallback((level: number) => {
    setSpellSlots((prev) => {
      if (prev[level] && prev[level].used > 0) {
        return {
          ...prev,
          [level]: {
            ...prev[level],
            used: prev[level].used - 1,
          },
        };
      }
      return prev;
    });
  }, []);

  const longRest = useCallback(() => {
    setSpellSlots((prev) => {
      const restored = { ...prev };
      Object.keys(restored).forEach((level) => {
        restored[parseInt(level)].used = 0;
      });
      return restored;
    });
  }, []);

  const cantrips = useMemo(() =>
    spells.filter((spell) => spell.level === 0),
    [spells]
  );
  const leveledSpells = useMemo(() =>
    spells.filter((spell) => spell.level > 0),
    [spells]
  );

  return {
    spells,
    loading,
    error,
    spellSlots,
    spellcastingAbility,
    spellcastingMod,
    proficiencyBonus,
    spellAttackBonus,
    spellSaveDC,
    cantrips,
    leveledSpells,
    consumeSpellSlot,
    restoreSpellSlot,
    longRest,
  };
};
