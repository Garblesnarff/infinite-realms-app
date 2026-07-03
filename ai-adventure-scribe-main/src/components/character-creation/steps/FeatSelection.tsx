import { Award } from 'lucide-react';
import React, { useState, useEffect } from 'react';

import { FeatSelectionAbilityScoreCard } from './FeatSelectionAbilityScoreCard';
import { FeatSelectionFeatsCard } from './FeatSelectionFeatsCard';

import type { AbilityScores } from '@/types/character';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCharacter } from '@/contexts/CharacterContext';
import { feats } from '@/data/featOptions';
import { useToast } from '@/hooks/use-toast';

/**
 * FeatSelection component for choosing feats during character creation
 * Handles Ability Score Improvement vs Feat choice
 */
const FeatSelection: React.FC = () => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const character = state.character;

  const [selectionType, setSelectionType] = useState<'asi' | 'feat'>('asi');
  const [selectedFeat, setSelectedFeat] = useState<string>('');
  const [abilityIncreases, setAbilityIncreases] = useState<Record<string, number>>({
    strength: 0,
    dexterity: 0,
    constitution: 0,
    intelligence: 0,
    wisdom: 0,
    charisma: 0,
  });

  const currentLevel = character?.level || 1;
  const canChooseFeat = [4, 8, 12, 16, 19].includes(currentLevel);

  // Note: No early returns before hooks to satisfy rules-of-hooks

  /**
   * Handle ASI (Ability Score Improvement) selection
   */
  const handleAbilityIncrease = (ability: string, change: number) => {
    const currentScore =
      character?.abilityScores?.[ability as keyof typeof character.abilityScores]?.score || 10;
    const currentIncrease = abilityIncreases[ability];
    const newIncrease = Math.max(0, Math.min(2, currentIncrease + change));

    // Can't exceed 20 or use more than 2 points total
    const totalIncreases = Object.values({ ...abilityIncreases, [ability]: newIncrease }).reduce(
      (sum, val) => sum + val,
      0,
    );
    if (currentScore + newIncrease > 20 || totalIncreases > 2) {
      return;
    }

    setAbilityIncreases((prev) => ({
      ...prev,
      [ability]: newIncrease,
    }));
  };

  /**
   * Apply the selected improvement (ASI or Feat)
   */
  const applySelection = () => {
    if (selectionType === 'asi') {
      const totalIncreases = Object.values(abilityIncreases).reduce((sum, val) => sum + val, 0);
      if (totalIncreases !== 2) {
        toast({
          title: 'Invalid Selection',
          description: 'You must spend exactly 2 ability score points.',
          variant: 'destructive',
        });
        return;
      }

      // Apply ASI to character
      const updatedAbilityScores = { ...character?.abilityScores };
      Object.entries(abilityIncreases).forEach(([ability, increase]) => {
        if (increase > 0 && updatedAbilityScores?.[ability as keyof typeof updatedAbilityScores]) {
          const current = updatedAbilityScores[ability as keyof typeof updatedAbilityScores];
          if (current) {
            current.score += increase;
            current.modifier = Math.floor((current.score - 10) / 2);
          }
        }
      });

      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { abilityScores: updatedAbilityScores as AbilityScores },
      });

      toast({
        title: 'Ability Scores Improved',
        description: 'Your ability scores have been increased.',
      });
    } else {
      if (!selectedFeat) {
        toast({
          title: 'No Feat Selected',
          description: 'Please select a feat to continue.',
          variant: 'destructive',
        });
        return;
      }

      // Apply feat to character
      const currentFeats = character?.feats || [];
      const feat = feats.find((f) => f.id === selectedFeat);

      if (feat) {
        // Apply ASI from feat if it has one
        if (feat.abilityScoreIncrease) {
          const updatedAbilityScores = { ...character?.abilityScores };
          Object.entries(feat.abilityScoreIncrease).forEach(([ability, increase]) => {
            if (increase && updatedAbilityScores?.[ability as keyof typeof updatedAbilityScores]) {
              const current = updatedAbilityScores[ability as keyof typeof updatedAbilityScores];
              if (current) {
                current.score += increase;
                current.modifier = Math.floor((current.score - 10) / 2);
              }
            }
          });

          dispatch({
            type: 'UPDATE_CHARACTER',
            payload: {
              feats: [...currentFeats, selectedFeat],
              abilityScores: updatedAbilityScores as AbilityScores,
            },
          });
        } else {
          dispatch({
            type: 'UPDATE_CHARACTER',
            payload: { feats: [...currentFeats, selectedFeat] },
          });
        }

        toast({
          title: 'Feat Selected',
          description: `You have gained the ${feat.name} feat.`,
        });
      }
    }
  };

  // Auto-apply when selection is complete
  useEffect(() => {
    if (selectionType === 'asi') {
      const totalIncreases = Object.values(abilityIncreases).reduce((sum, val) => sum + val, 0);
      if (totalIncreases === 2) {
        applySelection();
      }
    } else if (selectionType === 'feat' && selectedFeat) {
      applySelection();
    }
  }, [selectionType, abilityIncreases, selectedFeat]);

  return !canChooseFeat ? (
    <div className="text-center space-y-4">
      <Award className="w-16 h-16 mx-auto text-muted-foreground" />
      <h2 className="text-2xl font-bold">No Feat Selection</h2>
      <p className="text-muted-foreground">
        Feats become available at levels 4, 8, 12, 16, and 19.
      </p>
      <p className="text-sm text-muted-foreground">
        Your character is currently level {currentLevel}.
      </p>
    </div>
  ) : (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Ability Score Improvement</h2>
        <p className="text-muted-foreground">
          At level {currentLevel}, you can improve your abilities or gain a feat
        </p>
      </div>

      {/* ASI vs Feat Choice */}
      <Card>
        <CardHeader>
          <CardTitle>Choose Your Improvement</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={selectionType}
            onValueChange={(value: 'asi' | 'feat') => setSelectionType(value)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="asi" id="asi" />
              <Label htmlFor="asi">
                <strong>Ability Score Improvement</strong> - Increase two different ability scores
                by 1 each, or one ability score by 2
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="feat" id="feat" />
              <Label htmlFor="feat">
                <strong>Feat</strong> - Gain a special ability that provides unique benefits
              </Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* ASI Selection */}
      {selectionType === 'asi' && (
        <FeatSelectionAbilityScoreCard
          abilityScores={character?.abilityScores}
          abilityIncreases={abilityIncreases}
          onIncrease={handleAbilityIncrease}
        />
      )}

      {/* Feat Selection */}
      {selectionType === 'feat' && (
        <FeatSelectionFeatsCard selectedFeat={selectedFeat} onSelectFeat={setSelectedFeat} />
      )}

      {/* Manual Apply Button (fallback) */}
      <div className="flex justify-center">
        <Button onClick={applySelection} className="mt-4">
          Apply Selection
        </Button>
      </div>
    </div>
  );
};

export default FeatSelection;
