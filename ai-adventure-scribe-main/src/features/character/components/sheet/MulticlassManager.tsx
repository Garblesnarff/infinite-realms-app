import React, { useState } from 'react';

import { ClassDetailCard } from './multiclass/ClassDetailCard';
import { MulticlassSummary } from './multiclass/MulticlassSummary';

import type { ClassLevel } from './multiclass/types';
import type { Character, CharacterClass } from '@/types/character';

import { TooltipProvider } from '@/components/ui/tooltip';
import { getProficiencyBonus } from '@/data/levelProgression';
import { useToast } from '@/hooks/use-toast';
import { useMulticlassing } from '@/hooks/use-multiclassing';
import logger from '@/lib/logger';



interface MulticlassManagerProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
  availableClasses?: CharacterClass[]; // List of available classes to multiclass into
}

/**
 * MulticlassManager component for managing multiclass characters
 * Shows class levels, combined features, and progression tracking
 */
const MulticlassManager: React.FC<MulticlassManagerProps> = ({
  character,
  onUpdate,
  availableClasses = [],
}) => {
  const { toast } = useToast();
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const {
    isProcessing,
    validationResult,
    validateNewClass: _validateNewClass,
    addNewClass,
    levelUpSpecificClass,
    getProficiencies,
    getHitPoints,
    getSpellcasting,
    isMulticlassed,
    getTotalLevel,
  } = useMulticlassing(character, onUpdate);

  // Prepare class levels data
  const classLevels: ClassLevel[] = character.classLevels
    ? character.classLevels.map((cls) => ({
        classId: cls.classId,
        className: cls.className,
        level: cls.level,
        hitDie: cls.hitDie,
      }))
    : character.class
      ? [
          {
            classId: character.class.id,
            className: character.class.name,
            level: character.level || 1,
            hitDie: character.class.hitDie,
          },
        ]
      : [];

  const totalLevel = getTotalLevel();
  const proficiencyBonus = getProficiencyBonus(totalLevel);
  const proficiencies = getProficiencies();
  const hitPoints = getHitPoints();
  const spellcasting = getSpellcasting();
  const isSpellcaster = spellcasting.spellSlots.length > 0;

  /**
   * Toggle expanded state for a class
   */
  const toggleClassExpansion = (classId: string) => {
    const newExpanded = new Set(expandedClasses);
    if (newExpanded.has(classId)) {
      newExpanded.delete(classId);
    } else {
      newExpanded.add(classId);
    }
    setExpandedClasses(newExpanded);
  };

  /**
   * Handle adding a new class
   */
  const handleAddClass = async (newClass: CharacterClass) => {
    const result = await addNewClass(newClass, 1);
    if (!result.success) {
      toast({
        title: 'Cannot add class',
        description: result.message,
        variant: 'destructive',
      });
      logger.error(result.message);
    }
  };

  /**
   * Handle leveling up a class
   */
  const handleLevelUpClass = async (classId: string) => {
    const result = await levelUpSpecificClass(classId);
    if (!result.success) {
      toast({
        title: 'Cannot level up class',
        description: result.message,
        variant: 'destructive',
      });
      logger.error(result.message);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <MulticlassSummary
          totalLevel={totalLevel}
          proficiencyBonus={proficiencyBonus}
          classLevels={classLevels}
          onLevelUpClass={handleLevelUpClass}
          isProcessing={isProcessing}
          isMulticlassed={isMulticlassed}
          availableClasses={availableClasses}
          onAddClass={handleAddClass}
          validationResult={validationResult}
          isSpellcaster={isSpellcaster}
          spellcasting={spellcasting}
          proficiencies={proficiencies}
          hitPoints={hitPoints}
        />

        {/* Individual Class Details */}
        <div className="space-y-4">
          {classLevels.map((cls) => (
            <ClassDetailCard
              key={cls.classId}
              cls={cls}
              isExpanded={expandedClasses.has(cls.classId)}
              onToggle={() => toggleClassExpansion(cls.classId)}
            />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default MulticlassManager;
