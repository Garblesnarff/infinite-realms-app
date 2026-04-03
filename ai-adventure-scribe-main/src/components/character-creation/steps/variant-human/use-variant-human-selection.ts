import { useState, useEffect } from 'react';

import type { AbilityScores } from '@/types/character';

import { useToast } from '@/components/ui/use-toast';
import { useCharacter } from '@/contexts/CharacterContext';
import { feats } from '@/data/featOptions';

/**
 * Hook for managing Variant Human and Custom Lineage selection logic
 * Extracted from VariantHumanSelection.tsx
 */
export const useVariantHumanSelection = (): {
  isVariantHuman: boolean;
  isCustomLineage: boolean;
  selectedAbilities: string[];
  selectedFeat: string;
  setSelectedFeat: (feat: string) => void;
  selectedSkill: string;
  setSelectedSkill: (skill: string) => void;
  selectedLanguage: string;
  setSelectedLanguage: (language: string) => void;
  selectedTool: string;
  setSelectedTool: (tool: string) => void;
  hasdarkvision: boolean;
  setHasDarkvision: (hasDarkvision: boolean) => void;
  customLineageSize: 'small' | 'medium';
  setCustomLineageSize: (size: 'small' | 'medium') => void;
  availableAbilities: string[];
  availableSkills: string[];
  availableLanguages: string[];
  availableTools: string[];
  handleAbilitySelection: (ability: string) => void;
  applySelections: () => void;
} => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const character = state.character;
  const subrace = character?.subrace;

  const [selectedAbilities, setSelectedAbilities] = useState<string[]>([]);
  const [selectedFeat, setSelectedFeat] = useState<string>('');
  const [selectedSkill, setSelectedSkill] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [hasdarkvision, setHasDarkvision] = useState<boolean>(true);
  const [customLineageSize, setCustomLineageSize] = useState<'small' | 'medium'>('medium');

  const isVariantHuman = subrace?.id === 'variant-human';
  const isCustomLineage = subrace?.id === 'custom-lineage';

  const availableAbilities = [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ];
  const availableSkills = [
    'Acrobatics',
    'Animal Handling',
    'Arcana',
    'Athletics',
    'Deception',
    'History',
    'Insight',
    'Intimidation',
    'Investigation',
    'Medicine',
    'Nature',
    'Perception',
    'Performance',
    'Persuasion',
    'Religion',
    'Sleight of Hand',
    'Stealth',
    'Survival',
  ];
  const availableLanguages = [
    'Dwarvish',
    'Elvish',
    'Giant',
    'Gnomish',
    'Halfling',
    'Infernal',
    'Orc',
    'Abyssal',
    'Celestial',
    'Deep Speech',
    'Draconic',
    'Sylvan',
    'Undercommon',
  ];
  const availableTools = [
    "Smith's Tools",
    "Carpenter's Tools",
    "Cobbler's Tools",
    "Cook's Utensils",
    "Jeweler's Tools",
    "Leatherworker's Tools",
    "Mason's Tools",
    "Painter's Supplies",
    "Potter's Tools",
    "Tinker's Tools",
    "Weaver's Tools",
    "Woodcarver's Tools",
  ];

  /**
   * Handle ability score selection
   */
  const handleAbilitySelection = (ability: string): void => {
    if (isVariantHuman) {
      // Variant Human: Choose 2 different abilities
      if (selectedAbilities.includes(ability)) {
        setSelectedAbilities(selectedAbilities.filter((a) => a !== ability));
      } else if (selectedAbilities.length < 2) {
        setSelectedAbilities([...selectedAbilities, ability]);
      }
    } else if (isCustomLineage) {
      // Custom Lineage: Choose 1 ability for +2, or 2 abilities for +1 each
      if (selectedAbilities.includes(ability)) {
        setSelectedAbilities(selectedAbilities.filter((a) => a !== ability));
      } else {
        setSelectedAbilities([ability]);
      }
    }
  };

  /**
   * Apply all selections to character
   */
  const applySelections = (): void => {
    // Validate selections
    if (isVariantHuman && selectedAbilities.length !== 2) {
      toast({
        title: 'Incomplete Selection',
        description: 'Variant Humans must select 2 different ability scores to increase.',
        variant: 'destructive',
      });
      return;
    }

    if (isCustomLineage && selectedAbilities.length !== 1) {
      toast({
        title: 'Incomplete Selection',
        description: 'Custom Lineage must select 1 ability score to increase.',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedFeat) {
      toast({
        title: 'No Feat Selected',
        description: 'Please select a feat to continue.',
        variant: 'destructive',
      });
      return;
    }

    if (isVariantHuman && !selectedSkill) {
      toast({
        title: 'No Skill Selected',
        description: 'Variant Humans must select a skill proficiency.',
        variant: 'destructive',
      });
      return;
    }

    // Apply ability score increases
    const updatedAbilityScores = { ...character?.abilityScores };
    selectedAbilities.forEach((ability) => {
      if (updatedAbilityScores?.[ability as keyof typeof updatedAbilityScores]) {
        const current = updatedAbilityScores[ability as keyof typeof updatedAbilityScores];
        if (current) {
          if (isVariantHuman) {
            current.score += 1;
          } else if (isCustomLineage) {
            current.score += 2;
          }
          current.modifier = Math.floor((current.score - 10) / 2);
        }
      }
    });

    // Apply feat
    const currentFeats = character?.feats || [];
    const feat = feats.find((f) => f.id === selectedFeat);

    if (feat?.abilityScoreIncrease) {
      // Apply ASI from feat
      Object.entries(feat.abilityScoreIncrease).forEach(([ability, increase]) => {
        if (increase && updatedAbilityScores?.[ability as keyof typeof updatedAbilityScores]) {
          const current = updatedAbilityScores[ability as keyof typeof updatedAbilityScores];
          if (current) {
            current.score += increase;
            current.modifier = Math.floor((current.score - 10) / 2);
          }
        }
      });
    }

    // Apply skill proficiency (Variant Human)
    let skillProficiencies = character?.skillProficiencies || [];
    if (isVariantHuman && selectedSkill && !skillProficiencies.includes(selectedSkill)) {
      skillProficiencies = [...skillProficiencies, selectedSkill];
    }

    // Apply language or tool proficiency
    let languages = character?.languages || [];
    let toolProficiencies = character?.toolProficiencies || [];

    if (selectedLanguage && !languages.includes(selectedLanguage)) {
      languages = [...languages, selectedLanguage];
    }

    if (selectedTool && !toolProficiencies.includes(selectedTool)) {
      toolProficiencies = [...toolProficiencies, selectedTool];
    }

    // Update character
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        abilityScores: updatedAbilityScores as AbilityScores,
        feats: [...currentFeats, selectedFeat],
        skillProficiencies,
        toolProficiencies,
        languages,
      },
    });

    toast({
      title: 'Customization Complete',
      description: `Your ${isVariantHuman ? 'Variant Human' : 'Custom Lineage'} has been configured.`,
    });
  };

  // Auto-apply when all required selections are made
  useEffect(() => {
    const requiredSelections = [
      selectedFeat,
      ...(isVariantHuman
        ? [selectedAbilities.length === 2, selectedSkill]
        : [selectedAbilities.length === 1]),
    ];

    if (requiredSelections.every(Boolean)) {
      applySelections();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAbilities, selectedFeat, selectedSkill, selectedLanguage, selectedTool, isVariantHuman]);

  return {
    isVariantHuman,
    isCustomLineage,
    selectedAbilities,
    selectedFeat,
    setSelectedFeat,
    selectedSkill,
    setSelectedSkill,
    selectedLanguage,
    setSelectedLanguage,
    selectedTool,
    setSelectedTool,
    hasdarkvision,
    setHasDarkvision,
    customLineageSize,
    setCustomLineageSize,
    availableAbilities,
    availableSkills,
    availableLanguages,
    availableTools,
    handleAbilitySelection,
    applySelections,
  };
};
