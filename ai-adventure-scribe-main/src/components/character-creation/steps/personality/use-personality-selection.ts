import { useCallback } from 'react';

import type { PersonalityElement } from '@/services/personalityService';

import { useCharacter } from '@/contexts/CharacterContext';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { personalityService } from '@/services/personalityService';
import { describeCaughtError } from '@/utils/describe-caught-error';

export const extractPersonalityText = (
  element: PersonalityElement | null | undefined,
  fieldType: 'traits' | 'ideals' | 'bonds' | 'flaws',
): string => {
  if (!element || typeof element !== 'object') {
    return '';
  }

  switch (fieldType) {
    case 'traits':
      return element.text ?? '';
    case 'ideals':
      return element.ideal ?? element.text ?? '';
    case 'bonds':
      return element.bond ?? element.text ?? '';
    case 'flaws':
      return element.flaw ?? element.text ?? '';
    default:
      return element.text ?? '';
  }
};

export const usePersonalitySelection = () => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();

  const handlePersonalityTraitsChange = useCallback(
    (traits: string[]) => {
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { personalityTraits: traits },
      });
    },
    [dispatch],
  );

  const handleIdealChange = useCallback(
    (ideal: string) => {
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { ideals: [ideal] },
      });
    },
    [dispatch],
  );

  const handleBondChange = useCallback(
    (bond: string) => {
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { bonds: [bond] },
      });
    },
    [dispatch],
  );

  const handleFlawChange = useCallback(
    (flaw: string) => {
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { flaws: [flaw] },
      });
    },
    [dispatch],
  );

  const selectedBackground = state.character?.background;

  const handleRandomize = useCallback(
    async (fieldType: 'traits' | 'ideals' | 'bonds' | 'flaws', index?: number) => {
      try {
        const options = {
          background: selectedBackground?.id,
          alignment: state.character?.alignment,
        };

        const element = await personalityService.getRandomPersonalityElement(fieldType, options);
        const randomText = extractPersonalityText(element, fieldType);

        if (!randomText) {
          logger.warn(`No text extracted for ${fieldType}:`, element);
          toast({
            title: 'Error',
            description: 'Failed to randomize. Please try again.',
            variant: 'destructive',
          });
          return;
        }

        switch (fieldType) {
          case 'traits':
            if (index !== undefined) {
              const currentTraits = state.character?.personalityTraits || ['', ''];
              const newTraits = [...currentTraits];
              newTraits[index] = randomText;
              handlePersonalityTraitsChange(newTraits);
            }
            break;
          case 'ideals':
            handleIdealChange(randomText);
            break;
          case 'bonds':
            handleBondChange(randomText);
            break;
          case 'flaws':
            handleFlawChange(randomText);
            break;
        }

        toast({
          title: 'Randomized!',
          description: `Generated a random ${fieldType.slice(0, -1)} for your character.`,
          duration: 1500,
        });
      } catch (error) {
        logger.error('Error randomizing personality element:', describeCaughtError(error));
        toast({
          title: 'Error',
          description: 'Failed to randomize. Please try again.',
          variant: 'destructive',
        });
      }
    },
    [
      selectedBackground?.id,
      state.character?.alignment,
      state.character?.personalityTraits,
      handlePersonalityTraitsChange,
      handleIdealChange,
      handleBondChange,
      handleFlawChange,
      toast,
    ],
  );

  const handleRandomizeAll = useCallback(async () => {
    try {
      const options = {
        background: typeof selectedBackground?.id === 'string' ? selectedBackground.id : undefined,
        alignment:
          typeof state.character?.alignment === 'string' ? state.character.alignment : undefined,
      };

      const batchData = await personalityService.getBatchRandomPersonality(options);
      if (!batchData || typeof batchData !== 'object') {
        throw new Error('Batch personality response was empty');
      }

      if (batchData.traits && batchData.traits2) {
        const trait1 = extractPersonalityText(batchData.traits, 'traits');
        const trait2 = extractPersonalityText(batchData.traits2, 'traits');
        if (trait1 && trait2) {
          handlePersonalityTraitsChange([trait1, trait2]);
        }
      } else if (batchData.traits) {
        const trait1 = extractPersonalityText(batchData.traits, 'traits');
        if (trait1) {
          const currentTraits = state.character?.personalityTraits || ['', ''];
          handlePersonalityTraitsChange([trait1, currentTraits[1]]);
        }
      }

      if (batchData.ideals) {
        const idealText = extractPersonalityText(batchData.ideals, 'ideals');
        if (idealText) {
          handleIdealChange(idealText);
        }
      }

      if (batchData.bonds) {
        const bondText = extractPersonalityText(batchData.bonds, 'bonds');
        if (bondText) {
          handleBondChange(bondText);
        }
      }

      if (batchData.flaws) {
        const flawText = extractPersonalityText(batchData.flaws, 'flaws');
        if (flawText) {
          handleFlawChange(flawText);
        }
      }

      toast({
        title: 'All Randomized!',
        description: 'Generated a complete personality for your character.',
        duration: 2000,
      });
    } catch (error) {
      logger.error('Error randomizing all personality elements:', describeCaughtError(error));
      toast({
        title: 'Error',
        description: 'Failed to randomize all fields. Please try again.',
        variant: 'destructive',
      });
    }
  }, [
    selectedBackground?.id,
    state.character?.alignment,
    state.character?.personalityTraits,
    handlePersonalityTraitsChange,
    handleIdealChange,
    handleBondChange,
    handleFlawChange,
    toast,
  ]);

  return {
    state,
    selectedBackground,
    handlePersonalityTraitsChange,
    handleIdealChange,
    handleBondChange,
    handleFlawChange,
    handleRandomize,
    handleRandomizeAll,
  };
};
