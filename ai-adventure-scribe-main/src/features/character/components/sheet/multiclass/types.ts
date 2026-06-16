import type { CharacterClass } from '@/types/character';
import type { calculateMulticlassSpellcasting } from '@/utils/multiclass/spellcasting';
import type { calculateMulticlassProficiencies, MulticlassValidationResult } from '@/utils/multiclassing';

export interface ClassLevel {
  classId: string;
  className: string;
  level: number;
  hitDie: number;
}

export type MulticlassSpellcasting = ReturnType<typeof calculateMulticlassSpellcasting>;
export type MulticlassProficiencies = ReturnType<typeof calculateMulticlassProficiencies>;

export interface MulticlassSummaryProps {
  totalLevel: number;
  proficiencyBonus: number;
  classLevels: ClassLevel[];
  onLevelUpClass: (classId: string) => void;
  isProcessing: boolean;
  isMulticlassed: () => boolean;
  availableClasses: CharacterClass[];
  onAddClass: (newClass: CharacterClass) => void;
  validationResult: MulticlassValidationResult | null;
  isSpellcaster: boolean;
  spellcasting: MulticlassSpellcasting;
  proficiencies: MulticlassProficiencies;
  hitPoints: number;
}
