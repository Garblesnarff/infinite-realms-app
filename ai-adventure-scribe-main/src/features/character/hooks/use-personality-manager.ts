import { useState, useCallback, useMemo } from 'react';

import type { Character } from '@/types/character';

import { useToast } from '@/components/ui/use-toast';

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
  inspirationNotes: string;
  setInspirationNotes: (value: string) => void;
  personalityTraits: string[];
  ideals: string[];
  bonds: string[];
  flaws: string[];
  hasInspiration: boolean;
  inspirationHistory: InspirationEntry[];
  toggleInspiration: () => void;
  awardInspiration: (
    trigger: string,
    source: InspirationEntry['source'],
    description: string,
  ) => void;
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
  onUpdate: (updatedCharacter: Character) => void,
): UsePersonalityManagerReturn {
  const { toast } = useToast();

  const [newTrait, setNewTrait] = useState('');
  const [newIdeal, setNewIdeal] = useState('');
  const [newBond, setNewBond] = useState('');
  const [newFlaw, setNewFlaw] = useState('');
  const [inspirationNotes, setInspirationNotes] = useState('');

  const personalityTraits = useMemo(() => character?.personalityTraits || [], [character?.personalityTraits]);
  const ideals = useMemo(() => character?.ideals || [], [character?.ideals]);
  const bonds = useMemo(() => character?.bonds || [], [character?.bonds]);
  const flaws = useMemo(() => character?.flaws || [], [character?.flaws]);
  const hasInspiration = character?.inspiration || false;
  const inspirationHistory = useMemo(() => (character?.personalityIntegration?.inspirationHistory ||
    []) as InspirationEntry[], [character?.personalityIntegration?.inspirationHistory]);

  /**
   * Toggle inspiration state
   */
  const toggleInspiration = useCallback(() => {
    const newInspirationState = !hasInspiration;

    onUpdate({
      ...character,
      inspiration: newInspirationState,
      personalityIntegration: {
        ...character?.personalityIntegration,
        activeTraits: character?.personalityIntegration?.activeTraits || [],
        inspirationTriggers: character?.personalityIntegration?.inspirationTriggers || [],
        lastInspiration: newInspirationState
          ? new Date().toISOString()
          : character?.personalityIntegration?.lastInspiration,
        inspirationHistory: character?.personalityIntegration?.inspirationHistory || [],
      },
    });

    toast({
      title: newInspirationState ? 'Inspiration Gained!' : 'Inspiration Used',
      description: newInspirationState ? 'You now have inspiration.' : 'Inspiration has been used.',
    });
  }, [character, hasInspiration, onUpdate, toast]);

  /**
   * Award inspiration with reason
   */
  const awardInspiration = useCallback(
    (trigger: string, source: InspirationEntry['source'], description: string) => {
      if (hasInspiration) {
        toast({
          title: 'Already Have Inspiration',
          description: 'You already have inspiration. Use it before gaining more.',
          variant: 'destructive',
        });
        return;
      }

      const newEntry: InspirationEntry = {
        date: new Date().toISOString(),
        trigger,
        source,
        description,
      };

      const newHistory = [...inspirationHistory, newEntry];

      onUpdate({
        ...character,
        inspiration: true,
        personalityIntegration: {
          ...character?.personalityIntegration,
          activeTraits: character?.personalityIntegration?.activeTraits || [],
          inspirationTriggers: character?.personalityIntegration?.inspirationTriggers || [],
          lastInspiration: new Date().toISOString(),
          inspirationHistory: newHistory,
        },
      });

      toast({
        title: 'Inspiration Awarded!',
        description: `Gained inspiration for: ${description}`,
      });

      setInspirationNotes('');
    },
    [character, hasInspiration, inspirationHistory, onUpdate, toast],
  );

  /**
   * Add new personality element
   */
  const addPersonalityElement = useCallback(
    (type: 'trait' | 'ideal' | 'bond' | 'flaw', value: string) => {
      if (!value.trim()) return;

      const updates: Partial<Character> = {};

      switch (type) {
        case 'trait':
          updates.personalityTraits = [...personalityTraits, value];
          setNewTrait('');
          break;
        case 'ideal':
          updates.ideals = [...ideals, value];
          setNewIdeal('');
          break;
        case 'bond':
          updates.bonds = [...bonds, value];
          setNewBond('');
          break;
        case 'flaw':
          updates.flaws = [...flaws, value];
          setNewFlaw('');
          break;
      }

      onUpdate({
        ...character,
        ...updates,
      });

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
    (type: 'trait' | 'ideal' | 'bond' | 'flaw', index: number) => {
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

      onUpdate({
        ...character,
        ...updates,
      });

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
    inspirationNotes,
    setInspirationNotes,
    personalityTraits,
    ideals,
    bonds,
    flaws,
    hasInspiration,
    inspirationHistory,
    toggleInspiration,
    awardInspiration,
    addPersonalityElement,
    removePersonalityElement,
  };
}
