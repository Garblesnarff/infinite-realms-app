import { useState, useCallback, useMemo } from 'react';

import type { Character, CharacterSheetUpdateFn } from '@/types/character';

import { useToast } from '@/hooks/use-toast';

export interface InspirationEntry {
  date: string;
  trigger: string;
  source: 'trait' | 'ideal' | 'bond' | 'flaw' | 'dm';
  description: string;
}

export interface UsePersonalityManagerReturn {
  newTrait: string;
  setNewTrait: (value: string) => void;
  newIdeal: string;
  setNewIdeal: (value: string) => void;
  newBond: string;
  setNewBond: (value: string) => void;
  newFlaw: string;
  setNewFlaw: (value: string) => void;
  personalityTraits: string[];
  ideals: string[];
  bonds: string[];
  flaws: string[];
  hasInspiration: boolean;
  inspirationHistory: InspirationEntry[];
  addPersonalityElement: (type: 'trait' | 'ideal' | 'bond' | 'flaw', value: string) => void;
  removePersonalityElement: (type: 'trait' | 'ideal' | 'bond' | 'flaw', index: number) => void;
}

/**
 * usePersonalityManager Hook
 * Extracted from PersonalityManager.tsx
 * Manages character personality traits and inspiration state
 */
export function usePersonalityManager(
  character: Character,
  onUpdate: CharacterSheetUpdateFn,
): UsePersonalityManagerReturn {
  const { toast } = useToast();

  const [newTrait, setNewTrait] = useState('');
  const [newIdeal, setNewIdeal] = useState('');
  const [newBond, setNewBond] = useState('');
  const [newFlaw, setNewFlaw] = useState('');

  const personalityTraits = useMemo(
    () => character?.personalityTraits || [],
    [character?.personalityTraits],
  );
  const ideals = useMemo(() => character?.ideals || [], [character?.ideals]);
  const bonds = useMemo(() => character?.bonds || [], [character?.bonds]);
  const flaws = useMemo(() => character?.flaws || [], [character?.flaws]);
  const hasInspiration = character?.inspiration === true;
  const inspirationHistory = useMemo(
    () => (character?.personalityIntegration?.inspirationHistory || []) as InspirationEntry[],
    [character?.personalityIntegration?.inspirationHistory],
  );

  /**
   * Add new personality element
   */
  const addPersonalityElement = useCallback(
    async (type: 'trait' | 'ideal' | 'bond' | 'flaw', value: string) => {
      if (!value.trim()) return;

      const updates: Partial<Character> = {};
      const clearInput = () => {
        switch (type) {
          case 'trait':
            setNewTrait('');
            break;
          case 'ideal':
            setNewIdeal('');
            break;
          case 'bond':
            setNewBond('');
            break;
          case 'flaw':
            setNewFlaw('');
            break;
        }
      };

      switch (type) {
        case 'trait':
          updates.personalityTraits = [...personalityTraits, value];
          break;
        case 'ideal':
          updates.ideals = [...ideals, value];
          break;
        case 'bond':
          updates.bonds = [...bonds, value];
          break;
        case 'flaw':
          updates.flaws = [...flaws, value];
          break;
      }

      const payloadCharacter = { ...(character || {}) };
      delete (payloadCharacter as { inspiration?: unknown }).inspiration;
      const saved = await onUpdate({
        ...payloadCharacter,
        ...updates,
      });
      if (!saved) {
        // The persistence layer already toasted the failure.
        return;
      }
      clearInput();

      toast({
        title: `${type.charAt(0).toUpperCase() + type.slice(1)} Added`,
        description: `New ${type} has been added to your character.`,
      });
    },
    [character, personalityTraits, ideals, bonds, flaws, onUpdate, toast],
  );

  /**
   * Remove personality element
   */
  const removePersonalityElement = useCallback(
    async (type: 'trait' | 'ideal' | 'bond' | 'flaw', index: number) => {
      const updates: Partial<Character> = {};

      switch (type) {
        case 'trait':
          updates.personalityTraits = personalityTraits.filter((_, i) => i !== index);
          break;
        case 'ideal':
          updates.ideals = ideals.filter((_, i) => i !== index);
          break;
        case 'bond':
          updates.bonds = bonds.filter((_, i) => i !== index);
          break;
        case 'flaw':
          updates.flaws = flaws.filter((_, i) => i !== index);
          break;
      }

      const payloadCharacter = { ...(character || {}) };
      delete (payloadCharacter as { inspiration?: unknown }).inspiration;
      const saved = await onUpdate({
        ...payloadCharacter,
        ...updates,
      });
      if (!saved) {
        // The persistence layer already toasted the failure.
        return;
      }

      toast({
        title: `${type.charAt(0).toUpperCase() + type.slice(1)} Removed`,
        description: `${type.charAt(0).toUpperCase() + type.slice(1)} has been removed.`,
      });
    },
    [character, personalityTraits, ideals, bonds, flaws, onUpdate, toast],
  );

  return {
    newTrait,
    setNewTrait,
    newIdeal,
    setNewIdeal,
    newBond,
    setNewBond,
    newFlaw,
    setNewFlaw,
    personalityTraits,
    ideals,
    bonds,
    flaws,
    hasInspiration,
    inspirationHistory,
    addPersonalityElement,
    removePersonalityElement,
  };
}
