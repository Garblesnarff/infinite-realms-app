export type Maybe<T> = T | null | undefined;

export type AbilityScoreRecord = Record<string, number>;

export interface EnhancementSelection {
  optionId: string;
  value: string | string[] | number;
  customValue?: string;
  aiGenerated?: boolean;
}

export interface EnhancementEffects {
  traits?: string[];
  skillBonus?: string[];
  abilityBonus?: Record<string, number>;
  languages?: string[];
  equipment?: string[];
}

export interface CharacterPromptData {
  name?: string | null;
  description?: string | null;
  race?: string | null;
  subrace?: string | null;
  class?: string | null;
  background?: string | null;
  level?: number | null;
  ability_scores?: AbilityScoreRecord | null;
  alignment?: string | null;
  personalityTraits?: string[];
  ideals?: string[];
  bonds?: string[];
  flaws?: string[];
  personality_notes?: string | null;
  enhancementSelections?: EnhancementSelection[];
  enhancementEffects?: EnhancementEffects;
  appearance?: string | null;
  personality_traits?: string | null;
  theme?: string | null;
  gender?: 'male' | 'female' | null;
  age?: number | null;
  height?: number | null;
  weight?: number | null;
  eyes?: string | null;
  skin?: string | null;
  hair?: string | null;
}

export interface DescriptionPromptOptions {
  enhanceExisting?: boolean;
  includeBackstory?: boolean;
  includePersonality?: boolean;
  includeAppearance?: boolean;
  tone?: 'heroic' | 'dark' | 'comedic' | 'serious' | 'mysterious';
}

export interface ImagePromptOptions {
  style: 'portrait' | 'action' | 'full-body' | 'character-sheet' | 'expression-sheet';
  artStyle:
    | 'fantasy-art'
    | 'anime'
    | 'realistic'
    | 'comic-book'
    | 'watercolor'
    | 'sketch'
    | 'oil-painting';
  theme: string;
}

export interface ExtractedDetails {
  physicalFeatures: string[];
  equipment: string[];
  distinguishingMarks: string[];
}
