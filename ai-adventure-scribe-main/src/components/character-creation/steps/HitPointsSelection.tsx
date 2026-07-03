import { Heart } from 'lucide-react';
import React, { useState, useEffect } from 'react';

import { HitPointsBreakdownCard } from './HitPointsBreakdownCard';
import { HitPointsFinalCard } from './HitPointsFinalCard';
import { HitPointsMethodCard } from './HitPointsMethodCard';
import { HitPointsRollingCard } from './HitPointsRollingCard';

import { Button } from '@/components/ui/button';
import { useCharacter } from '@/contexts/CharacterContext';
import { useToast } from '@/hooks/use-toast';

/**
 * HitPointsSelection component for determining maximum hit points
 * Allows rolling hit dice or taking the average value
 */
const HitPointsSelection: React.FC = () => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const character = state.character;
  const characterClass = character?.class;
  const level = character?.level || 1;
  const conModifier = character?.abilityScores?.constitution?.modifier || 0;

  const [method, setMethod] = useState<'roll' | 'average'>('average');
  const [rollResults, setRollResults] = useState<number[]>([]);
  const [isRolling, setIsRolling] = useState(false);

  // Note: No early returns before hooks to satisfy rules-of-hooks

  const hitDie = characterClass?.hitDie ?? 0;
  const averagePerLevel = Math.floor(hitDie / 2) + 1;

  /**
   * Calculate maximum hit points based on method
   */
  const calculateHitPoints = (useRolls: boolean = false): number => {
    if (level === 1) {
      // First level always gets max hit die + con modifier
      return hitDie + conModifier;
    }

    const firstLevelHP = hitDie + conModifier;

    if (useRolls && rollResults.length >= level - 1) {
      // Use rolled values for subsequent levels
      const additionalHP = rollResults
        .slice(0, level - 1)
        .reduce((sum, roll) => sum + roll + conModifier, 0);
      return firstLevelHP + additionalHP;
    } else {
      // Use average values
      const additionalHP = (level - 1) * (averagePerLevel + conModifier);
      return firstLevelHP + additionalHP;
    }
  };

  /**
   * Roll a hit die
   */
  const rollHitDie = (): number => {
    return Math.floor(Math.random() * hitDie) + 1;
  };

  /**
   * Handle rolling hit dice for all levels beyond 1st
   */
  const handleRollHitDice = async () => {
    if (level === 1) {
      applyHitPoints();
      return;
    }

    setIsRolling(true);
    const newRolls: number[] = [];

    // Animate rolling each level
    for (let i = 0; i < level - 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const roll = rollHitDie();
      newRolls.push(roll);
      setRollResults([...newRolls]);
    }

    setIsRolling(false);

    toast({
      title: 'Hit Dice Rolled',
      description: `Rolled ${newRolls.join(', ')} on d${hitDie}s.`,
    });
  };

  /**
   * Apply hit points to character
   */
  const applyHitPoints = () => {
    const useRolls = method === 'roll';
    const maxHP = calculateHitPoints(useRolls);

    const hitPoints = {
      maximum: maxHP,
      current: maxHP,
      temporary: 0,
    };

    const hitDice = {
      total: level,
      remaining: level,
      type: `d${hitDie}`,
    };

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        hitPoints,
        hitDice,
      },
    });

    toast({
      title: 'Hit Points Set',
      description: `Maximum hit points: ${maxHP}`,
    });
  };

  // Auto-apply when method is average or when rolling is complete
  useEffect(() => {
    if (method === 'average') {
      applyHitPoints();
    } else if (method === 'roll' && rollResults.length >= Math.max(0, level - 1)) {
      applyHitPoints();
    }
  }, [method, rollResults, level]);

  const maxHPPreview = calculateHitPoints(method === 'roll');
  const hasRolls = rollResults.length >= Math.max(0, level - 1);

  return !characterClass ? (
    <div className="text-center space-y-4">
      <Heart className="w-16 h-16 mx-auto text-muted-foreground" />
      <h2 className="text-2xl font-bold">Class Required</h2>
      <p className="text-muted-foreground">Please select a class first to determine hit points.</p>
    </div>
  ) : (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Hit Points</h2>
        <p className="text-muted-foreground">Determine your character's maximum hit points</p>
      </div>

      {/* Hit Point Calculation Summary */}
      <HitPointsBreakdownCard
        className={characterClass.name}
        hitDie={hitDie}
        level={level}
        conModifier={conModifier}
        method={method}
        averagePerLevel={averagePerLevel}
        hasRolls={hasRolls}
        rollResults={rollResults}
        maxHPPreview={maxHPPreview}
      />

      {/* Method Selection */}
      {level > 1 && (
        <HitPointsMethodCard
          method={method}
          hitDie={hitDie}
          averagePerLevel={averagePerLevel}
          onMethodChange={(value) => {
            setMethod(value);
            if (value === 'roll') {
              setRollResults([]);
            }
          }}
        />
      )}

      {/* Rolling Interface */}
      {method === 'roll' && level > 1 && (
        <HitPointsRollingCard
          level={level}
          hitDie={hitDie}
          conModifier={conModifier}
          rollResults={rollResults}
          isRolling={isRolling}
          hasRolls={hasRolls}
          onRoll={handleRollHitDice}
          onReroll={() => {
            setRollResults([]);
            toast({
              title: 'Rolls Reset',
              description: 'You can now roll hit dice again.',
            });
          }}
        />
      )}

      {/* Final HP Display */}
      <HitPointsFinalCard maxHPPreview={maxHPPreview} level={level} hitDie={hitDie} />

      {/* Manual Apply Button (fallback) */}
      <div className="flex justify-center">
        <Button onClick={applyHitPoints} className="mt-4">
          Confirm Hit Points
        </Button>
      </div>
    </div>
  );
};

export default HitPointsSelection;
