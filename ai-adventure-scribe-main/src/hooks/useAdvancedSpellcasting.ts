/* eslint-disable max-lines */
import { useState, useEffect, useCallback, useMemo } from 'react';

import { abilityModifier as modifierForScore } from '../../shared/ability-modifier';

import type { Spell, Character } from '@/types/character';

import { useCharacter } from '@/contexts/CharacterContext';
import {
  getPactMagicProgression,
  calculateSpellsKnown,
  canCastRituals,
  hasPactMagic,
  hasMetamagic,
  getSorceryPoints,
  getMetamagicOptionsKnown,
} from '@/data/spellcastingFeatures';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { spellApi } from '@/services/spellApi';
import { getAlwaysPreparedSpells } from '@/utils/character/subclass-grants';
import { applyRacialBonusesToAbilityScores } from '@/utils/racialAbilityBonuses';

export interface UseAdvancedSpellcastingReturn {
  characterClass: Character['class'] | undefined;
  level: number;
  spellcastingAbility: string | undefined;
  abilityModifier: number;
  preparedSpells: string[];
  selectedMetamagic: string[];
  ritualSpells: string[];
  pactMagicSpells: string[];
  allSpells: Spell[];
  isLoadingSpells: boolean;
  hasSpellcasting: boolean;
  canPrepareSpells: boolean;
  usesRitualCasting: boolean;
  usesPactMagic: boolean;
  usesMetamagic: boolean;
  maxPreparedSpells: number;
  /** Subclass-granted spells that are always prepared (cleric domain spells); never counted against maxPreparedSpells. */
  alwaysPreparedSpells: string[];
  availableSpells: Spell[];
  availableRitualSpells: Spell[];
  pactProgression: ReturnType<typeof getPactMagicProgression> | null;
  maxPactSpells: number;
  sorceryPoints: number;
  maxMetamagicOptions: number;
  allSelectionsComplete: boolean;
  handleSpellPreparation: (spellId: string, checked: boolean) => void;
  handleMetamagicSelection: (optionId: string, checked: boolean) => void;
  handlePactSpellSelection: (spellId: string, checked: boolean) => void;
  applySpellcastingFeatures: () => void;
}

/**
 * useAdvancedSpellcasting hook - Extracted from AdvancedSpellcastingSelection.tsx
 * Handles state and logic for advanced spellcasting features during character creation
 */
export function useAdvancedSpellcasting(): UseAdvancedSpellcastingReturn {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const character = state.character;
  const characterClass = character?.class;
  const level = character?.level || 1;
  const spellcastingAbility = characterClass?.spellcasting?.ability;
  const finalScores = character?.abilityScores
    ? applyRacialBonusesToAbilityScores(
        character.abilityScores,
        character.race ?? null,
        character.subrace ?? null,
        character.racialAbilityChoices,
      )
    : undefined;
  const abilityModifier = spellcastingAbility
    ? modifierForScore(finalScores?.[spellcastingAbility]?.score ?? 10)
    : 0;

  const [preparedSpells, setPreparedSpells] = useState<string[]>([]);
  const [selectedMetamagic, setSelectedMetamagic] = useState<string[]>([]);
  const [ritualSpells] = useState<string[]>([]);
  // #763: a Warlock's pact spells are the spells picked on the earlier spell
  // step (knownSpells), so start from those, capped at the pact limit.
  const [pactMagicSpells, setPactMagicSpells] = useState<string[]>(() =>
    hasPactMagic(characterClass?.id || '')
      ? (character?.knownSpells ?? []).slice(0, getPactMagicProgression(level)?.spellsKnown ?? 0)
      : [],
  );
  const [allSpells, setAllSpells] = useState<Spell[]>([]);
  const [isLoadingSpells, setIsLoadingSpells] = useState(true);

  // Check if character has spellcasting
  const hasSpellcasting = characterClass?.spellcasting !== undefined;
  const canPrepareSpells = ['cleric', 'druid', 'paladin', 'wizard'].includes(
    characterClass?.id || '',
  );
  const usesRitualCasting = canCastRituals(characterClass?.id || '');
  const usesPactMagic = hasPactMagic(characterClass?.id || '');
  const usesMetamagic = hasMetamagic(characterClass?.id || '', level);

  // Calculate spell preparation limits
  const maxPreparedSpells = canPrepareSpells
    ? calculateSpellsKnown(characterClass?.id || '', level, abilityModifier)
    : 0;
  // #212 QA-043: only level 1+ spells are preparable; cantrips (level 0)
  // can never be prepared.
  // #320 CR-003: memoized. These were fresh array identities every render,
  // which changed applySpellcastingFeatures's identity every render and
  // re-fired the auto-apply effect forever once selections were complete
  // (toast flood + frozen page). Stable inputs keep the effect quiet.
  const maxPreparableLevel = Math.min(5, Math.ceil(level / 2));
  const availableSpells = useMemo(
    () => allSpells.filter((spell: Spell) => spell.level >= 1 && spell.level <= maxPreparableLevel),
    [allSpells, maxPreparableLevel],
  );
  const availableRitualSpells = useMemo(
    () =>
      allSpells.filter(
        (spell: Spell) => spell.ritual && spell.level >= 1 && spell.level <= maxPreparableLevel,
      ),
    [allSpells, maxPreparableLevel],
  );

  // Subclass-granted always-prepared spells (cleric domain spells, e.g. a
  // Life Domain cleric's Bless and Cure Wounds). They ride along with the
  // player's own picks at apply time and never consume a preparation slot.
  // Deps are the memo's actual inputs, not the whole character object: the
  // character's identity changes on this hook's own apply dispatch, and a
  // fresh array identity here would re-fire the auto-apply effect (#320).
  const classDataForGrants = character?.class;
  const classFeaturesForGrants = character?.classFeatures;
  const alwaysPreparedSpells = useMemo(
    () =>
      getAlwaysPreparedSpells({
        class: classDataForGrants,
        classFeatures: classFeaturesForGrants,
        level,
      }),
    [classDataForGrants, classFeaturesForGrants, level],
  );
  const alwaysPreparedIds = useMemo(
    () =>
      new Set(
        allSpells.filter((spell) => alwaysPreparedSpells.includes(spell.name)).map((s) => s.id),
      ),
    [allSpells, alwaysPreparedSpells],
  );
  const countChosenPreparations = useCallback(
    (ids: string[]): number => ids.filter((id) => !alwaysPreparedIds.has(id)).length,
    [alwaysPreparedIds],
  );

  // Pact Magic progression
  const pactProgression = usesPactMagic ? getPactMagicProgression(level) : null;
  const maxPactSpells = pactProgression?.spellsKnown || 0;

  // Metamagic
  const sorceryPoints = usesMetamagic ? getSorceryPoints(level) : 0;
  const maxMetamagicOptions = usesMetamagic ? getMetamagicOptionsKnown(level) : 0;

  // Check if all required selections are complete. Always-prepared domain
  // spells the player also picked by hand do not count toward the cap.
  const hasRequiredPreparations =
    !canPrepareSpells || countChosenPreparations(preparedSpells) === maxPreparedSpells;
  const hasRequiredMetamagic = !usesMetamagic || selectedMetamagic.length === maxMetamagicOptions;
  const hasRequiredPactSpells = !usesPactMagic || pactMagicSpells.length === maxPactSpells;
  const allSelectionsComplete =
    hasRequiredPreparations && hasRequiredMetamagic && hasRequiredPactSpells;

  /**
   * Apply all spellcasting selections
   */
  const applySpellcastingFeatures = useCallback((): void => {
    const updates: Partial<Character> & { advancedSpellcastingComplete?: boolean } = {};

    if (canPrepareSpells) {
      // #2710: preparedSpells holds names (for GET /v1/characters/:id/spells
      // which checks preparedSet.has(name)). preparedSpellIds holds the
      // kebab-case ids (for the save path which needs UUIDs).
      // Fail loudly if a name is missing — silent fallback hides bugs.
      const namesById = new Map(availableSpells.map((s) => [s.id, s.name]));
      const chosenNames = preparedSpells.map((id) => {
        const name = namesById.get(id);
        if (!name) {
          throw new Error(`#2710: no spell name for prepared spell id: ${id}`);
        }
        return name;
      });
      // Always-prepared subclass spells (cleric domain spells) join the
      // prepared list on top of the player's picks; a domain spell the
      // player also picked by hand is not duplicated.
      const grantedNames = alwaysPreparedSpells.filter((name) => !chosenNames.includes(name));
      const grantedIds = [...alwaysPreparedIds].filter((id) => !preparedSpells.includes(id));
      updates.preparedSpells = [...chosenNames, ...grantedNames];
      updates.preparedSpellIds = [...preparedSpells, ...grantedIds];
    }

    if (usesMetamagic) {
      updates.metamagicOptions = selectedMetamagic;
      updates.sorceryPoints = {
        maximum: sorceryPoints,
        current: sorceryPoints,
      };
    }

    if (usesPactMagic) {
      updates.pactMagicSpells = pactMagicSpells;
      updates.pactSlots = {
        maximum: pactProgression?.pactSlots || 0,
        current: pactProgression?.pactSlots || 0,
        level: pactProgression?.pactSlotLevel || 1,
      };
    }

    if (usesRitualCasting) {
      updates.ritualSpells = ritualSpells;
    }

    // Mark advanced spellcasting as complete
    updates.advancedSpellcastingComplete = true;

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: updates,
    });

    toast({
      title: 'Spellcasting Features Applied',
      description: 'Your advanced spellcasting features have been configured.',
    });
  }, [
    canPrepareSpells,
    preparedSpells,
    availableSpells,
    alwaysPreparedSpells,
    alwaysPreparedIds,
    usesMetamagic,
    selectedMetamagic,
    sorceryPoints,
    usesPactMagic,
    pactMagicSpells,
    pactProgression,
    usesRitualCasting,
    ritualSpells,
    dispatch,
    toast,
  ]);

  // Fetch class-specific spells on component mount
  useEffect(() => {
    const fetchSpells = async (): Promise<void> => {
      if (!characterClass?.name) {
        setAllSpells([]);
        setIsLoadingSpells(false);
        return;
      }

      try {
        const { cantrips, spells } = await spellApi.getClassSpells(characterClass.name, level);
        const allClassSpells = [...cantrips, ...spells];
        setAllSpells(allClassSpells);
      } catch (error) {
        logger.error('Failed to fetch class spells:', error);
        setAllSpells([]);
      } finally {
        setIsLoadingSpells(false);
      }
    };

    fetchSpells();
  }, [characterClass?.name, level]);

  // Auto-apply when all required selections are made
  useEffect(() => {
    // Don't auto-apply if component is still loading or has no spellcasting
    if (isLoadingSpells || !hasSpellcasting) return;

    // Auto-apply when all required features are complete
    if (allSelectionsComplete) {
      applySpellcastingFeatures();
    }
  }, [isLoadingSpells, hasSpellcasting, allSelectionsComplete, applySpellcastingFeatures]);

  // Auto-apply empty configuration for characters with no advanced features
  useEffect(() => {
    if (
      !isLoadingSpells &&
      (!hasSpellcasting ||
        (!canPrepareSpells && !usesMetamagic && !usesPactMagic && !usesRitualCasting))
    ) {
      const completionPayload: Partial<Character> & { advancedSpellcastingComplete?: boolean } = {};
      completionPayload.advancedSpellcastingComplete = true;
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: completionPayload,
      });
    }
  }, [
    isLoadingSpells,
    hasSpellcasting,
    canPrepareSpells,
    usesMetamagic,
    usesPactMagic,
    usesRitualCasting,
    dispatch,
  ]);

  /**
   * Handle spell preparation
   * ⚡ Bolt: Wrapped in useCallback with stable functional updates to avoid dependency on preparedSpells state array.
   */
  const handleSpellPreparation = useCallback(
    (spellId: string, checked: boolean): void => {
      if (checked) {
        setPreparedSpells((prev) => {
          if (prev.includes(spellId)) return prev;
          // Always-prepared domain spells are free: they can be picked (or
          // left to the automatic grant) without consuming a prepared slot.
          if (alwaysPreparedIds.has(spellId)) return [...prev, spellId];
          if (countChosenPreparations(prev) < maxPreparedSpells) {
            return [...prev, spellId];
          }
          return prev;
        });
      } else {
        setPreparedSpells((prev) => prev.filter((s) => s !== spellId));
      }
    },
    [maxPreparedSpells, alwaysPreparedIds, countChosenPreparations],
  );

  /**
   * Handle metamagic selection
   * ⚡ Bolt: Wrapped in useCallback with stable functional updates to avoid dependency on selectedMetamagic state array.
   */
  const handleMetamagicSelection = useCallback(
    (optionId: string, checked: boolean): void => {
      if (checked) {
        setSelectedMetamagic((prev) => {
          if (prev.length < maxMetamagicOptions && !prev.includes(optionId)) {
            return [...prev, optionId];
          }
          return prev;
        });
      } else {
        setSelectedMetamagic((prev) => prev.filter((m) => m !== optionId));
      }
    },
    [maxMetamagicOptions],
  );

  /**
   * Handle pact magic spells
   * ⚡ Bolt: Wrapped in useCallback with stable functional updates to avoid dependency on pactMagicSpells state array.
   */
  const handlePactSpellSelection = useCallback(
    (spellId: string, checked: boolean): void => {
      if (checked) {
        setPactMagicSpells((prev) => {
          if (prev.length < maxPactSpells && !prev.includes(spellId)) {
            return [...prev, spellId];
          }
          return prev;
        });
      } else {
        setPactMagicSpells((prev) => prev.filter((s) => s !== spellId));
      }
    },
    [maxPactSpells],
  );

  // ⚡ Bolt: Return object wrapped in useMemo to enforce referential identity stability and prevent downstream Virtual DOM re-renders.
  return useMemo(
    () => ({
      characterClass,
      level,
      spellcastingAbility,
      abilityModifier,
      preparedSpells,
      selectedMetamagic,
      ritualSpells,
      pactMagicSpells,
      allSpells,
      isLoadingSpells,
      hasSpellcasting,
      canPrepareSpells,
      usesRitualCasting,
      usesPactMagic,
      usesMetamagic,
      maxPreparedSpells,
      alwaysPreparedSpells,
      availableSpells,
      availableRitualSpells,
      pactProgression,
      maxPactSpells,
      sorceryPoints,
      maxMetamagicOptions,
      allSelectionsComplete,
      handleSpellPreparation,
      handleMetamagicSelection,
      handlePactSpellSelection,
      applySpellcastingFeatures,
    }),
    [
      characterClass,
      level,
      spellcastingAbility,
      abilityModifier,
      preparedSpells,
      selectedMetamagic,
      ritualSpells,
      pactMagicSpells,
      allSpells,
      isLoadingSpells,
      hasSpellcasting,
      canPrepareSpells,
      usesRitualCasting,
      usesPactMagic,
      usesMetamagic,
      maxPreparedSpells,
      alwaysPreparedSpells,
      availableSpells,
      availableRitualSpells,
      pactProgression,
      maxPactSpells,
      sorceryPoints,
      maxMetamagicOptions,
      allSelectionsComplete,
      handleSpellPreparation,
      handleMetamagicSelection,
      handlePactSpellSelection,
      applySpellcastingFeatures,
    ],
  );
}
