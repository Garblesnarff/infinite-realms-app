import { buildCharacterDescriptionPrompt } from './character-description-prompt';
import {
  appendPhysicalTraitsImagePrompt,
  buildCharacterConcept,
  buildCharacterDescriptionSegment,
  extractCharacterDetails,
  getArtStylePrompt,
} from './character-prompt-helpers';

import type {
  AbilityScoreRecord,
  CharacterPromptData,
  ImagePromptOptions,
} from './character-prompt-types';
import type { Character } from '@/types/character';

export { buildCharacterDescriptionPrompt };

export type {
  CharacterPromptData,
  DescriptionPromptOptions,
  ImagePromptOptions,
  EnhancementSelection,
  EnhancementEffects,
} from './character-prompt-types';

export const buildCharacterImagePrompt = (
  characterData: CharacterPromptData,
  options: ImagePromptOptions,
): string => {
  const { style, artStyle, theme } = options;
  const promptParts: string[] = [];
  const extracted = extractCharacterDetails(characterData);

  switch (style) {
    case 'portrait':
      promptParts.push(
        'D&D character portrait, head and shoulders view, facing forward or at slight angle',
      );
      break;
    case 'action':
      promptParts.push(
        'Dynamic D&D character action pose, showing character in combat or using abilities',
      );
      break;
    case 'full-body':
      promptParts.push(
        'Full body D&D character portrait, standing pose, complete outfit and equipment visible',
      );
      break;
    case 'character-sheet': {
      const characterConcept = buildCharacterConcept(characterData, extracted, theme);
      promptParts.push(
        `Character design sheet for ${characterConcept}, detailed with front, back, and side views, including close-up sketches of facial features and accessories, annotated with design notes and labeled components, drawn in blueprint style with glowing trim in ${theme}. Detailed line work on the face and hands, detailed anatomy of the character, detailed lines around the edges. Detailed character sketches with flat color and detailed line art illustration. Professional concept art style.`,
      );
      break;
    }
    case 'expression-sheet':
      promptParts.push(
        'D&D character expression sheet, same character with multiple facial expressions, happy, serious, angry, surprised, consistent character',
      );
      break;
  }

  if (style !== 'character-sheet') {
    const characterDesc = buildCharacterDescriptionSegment(characterData, extracted);
    if (characterDesc) promptParts.push(characterDesc);
    promptParts.push(getArtStylePrompt(artStyle));
  }

  if (style === 'character-sheet' || style === 'expression-sheet') {
    promptParts.push(
      'Clean white background, organized layout, professional character reference, consistent character design across all views',
    );
  } else {
    promptParts.push('Clean background, character as main focus, professional composition');
  }

  promptParts.push(
    'High detail, sharp focus, excellent lighting, rich colors, digital illustration quality',
  );

  appendPhysicalTraitsImagePrompt(promptParts, characterData);

  return promptParts.join(', ');
};

export const mapAbilityScores = (character: Character): AbilityScoreRecord | null => {
  if (!character.abilityScores) return null;
  const record: AbilityScoreRecord = {};
  (Object.entries(character.abilityScores) as Array<[string, { score?: number }]>).forEach(
    ([key, ability]) => {
      if (typeof ability?.score === 'number' && Number.isFinite(ability.score)) {
        record[key] = ability.score;
      }
    },
  );
  return Object.keys(record).length > 0 ? record : null;
};

export const toCharacterPromptData = (
  character: Character | null | undefined,
): CharacterPromptData => {
  if (!character) {
    return { name: 'Unnamed Character' };
  }

  return {
    name: character.name,
    description: character.description,
    race: character.race?.name || character.race?.id || null,
    subrace: character.subrace?.name || character.subrace?.id || null,
    class: character.class?.name || character.class?.id || null,
    background: character.background?.name || character.background?.id || null,
    level: character.level ?? null,
    ability_scores: mapAbilityScores(character),
    alignment: character.alignment ?? null,
    personalityTraits: character.personalityTraits,
    ideals: character.ideals,
    bonds: character.bonds,
    flaws: character.flaws,
    personality_notes: character.personality_notes ?? character.personalityNotes ?? null,
    enhancementSelections: character.enhancementSelections,
    enhancementEffects: character.enhancementEffects,
    appearance: character.appearance,
    personality_traits: character.personality_traits,
    theme: character.theme,
    gender: character.gender ?? null,
    age: character.age ?? null,
    height: character.height ?? null,
    weight: character.weight ?? null,
    eyes: character.eyes ?? null,
    skin: character.skin ?? null,
    hair: character.hair ?? null,
  };
};
