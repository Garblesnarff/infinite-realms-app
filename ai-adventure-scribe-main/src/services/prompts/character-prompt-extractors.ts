import {
  extractWeaponsFromClass,
  extractWeaponsFromEnhancements,
  summarizeOutfit,
  summarizeWeapons,
} from './character-outfit-weapons';
import {
  buildPhysicalTraitLines,
  getClassPrompt,
  getRacePrompt,
  getAlignmentPrompt,
} from './character-prompt-helpers';

import type {
  Maybe,
  CharacterPromptData,
  ExtractedDetails,
  EnhancementSelection,
} from './character-prompt-types';

/**
 * Extracted from character-prompt-helpers.ts
 * Handles character detail extraction and summarization for prompts
 */

export const extractCharacterDetails = (characterData: CharacterPromptData): ExtractedDetails => {
  const details: ExtractedDetails = {
    physicalFeatures: [],
    equipment: [],
    distinguishingMarks: [],
  };

  if (characterData.appearance) {
    const appearance = characterData.appearance.toLowerCase();

    if (appearance.includes('tall')) {
      details.physicalFeatures.push('tall stature');
    }
    if (appearance.includes('short')) {
      details.physicalFeatures.push('short stature');
    }
    if (appearance.includes('muscular')) {
      details.physicalFeatures.push('muscular build');
    }
    if (appearance.includes('lean')) {
      details.physicalFeatures.push('lean build');
    }
    if (appearance.includes('stocky')) {
      details.physicalFeatures.push('stocky build');
    }

    if (appearance.includes('brown hair')) {
      details.physicalFeatures.push('brown hair');
    }
    if (appearance.includes('black hair')) {
      details.physicalFeatures.push('black hair');
    }
    if (appearance.includes('blonde hair')) {
      details.physicalFeatures.push('blonde hair');
    }
    if (appearance.includes('red hair')) {
      details.physicalFeatures.push('red hair');
    }
    if (appearance.includes('white hair')) {
      details.physicalFeatures.push('white hair');
    }
    if (appearance.includes('braid')) {
      details.physicalFeatures.push('braided hair');
    }

    if (appearance.includes('blue eyes')) {
      details.physicalFeatures.push('blue eyes');
    }
    if (appearance.includes('green eyes')) {
      details.physicalFeatures.push('green eyes');
    }
    if (appearance.includes('brown eyes')) {
      details.physicalFeatures.push('brown eyes');
    }
    if (appearance.includes('piercing eyes')) {
      details.physicalFeatures.push('piercing gaze');
    }

    if (appearance.includes('scar')) {
      details.distinguishingMarks.push('battle scars');
    }
    if (appearance.includes('tattoo')) {
      details.distinguishingMarks.push('tattoos');
    }

    if (appearance.includes('leather armor')) {
      details.equipment.push('leather armor');
    }
    if (appearance.includes('plate armor')) {
      details.equipment.push('plate armor');
    }
    if (appearance.includes('chainmail')) {
      details.equipment.push('chainmail');
    }
    if (appearance.includes('surcoat')) {
      details.equipment.push('surcoat');
    }
  }

  const traits = buildPhysicalTraitLines(characterData);
  traits.forEach((trait) => details.physicalFeatures.push(trait.toLowerCase()));

  return details;
};

export const extractEnhancementVisuals = (
  enhancementSelections: EnhancementSelection[],
): string[] => {
  const visualElements: string[] = [];

  enhancementSelections.forEach((selection) => {
    const value = Array.isArray(selection.value)
      ? selection.value.join(' ')
      : String(selection.value);
    const combined = `${value} ${selection.customValue || ''}`.toLowerCase();

    if (combined.includes('scar')) {
      visualElements.push('distinctive scars');
    }
    if (combined.includes('tattoo')) {
      visualElements.push('meaningful tattoos');
    }
    if (combined.includes('piercing')) {
      visualElements.push('piercings');
    }
    if (combined.includes('jewelry') || combined.includes('ring') || combined.includes('necklace')) {
      visualElements.push('distinctive jewelry');
    }
    if (
      combined.includes('weapon') ||
      combined.includes('sword') ||
      combined.includes('axe') ||
      combined.includes('bow')
    ) {
      visualElements.push('special weapon');
    }
    if (combined.includes('armor') || combined.includes('shield')) {
      visualElements.push('unique armor');
    }
    if (combined.includes('cloak') || combined.includes('cape') || combined.includes('robe')) {
      visualElements.push('distinctive clothing');
    }
    if (combined.includes('mark') || combined.includes('brand') || combined.includes('symbol')) {
      visualElements.push('mystical markings');
    }
    if (combined.includes('aura') || combined.includes('glow') || combined.includes('magic')) {
      visualElements.push('magical aura');
    }
    if (combined.includes('eye') || combined.includes('gaze')) {
      visualElements.push('striking eyes');
    }
    if (combined.includes('hair') || combined.includes('beard')) {
      visualElements.push('distinctive hair');
    }
    if (combined.includes('posture') || combined.includes('stance')) {
      visualElements.push('unique posture');
    }
    if (combined.includes('familiar') || combined.includes('companion') || combined.includes('pet')) {
      visualElements.push('animal companion');
    }
  });

  return [...new Set(visualElements)];
};

export const extractVisualPersonalityTraits = (personalityText: Maybe<string>): string[] => {
  if (!personalityText) {
    return [];
  }
  const notes = personalityText.toLowerCase();
  const visualTraits: string[] = [];

  if (notes.includes('tourettes') || notes.includes('tics')) {
    visualTraits.push('subtle facial tics');
  }
  if (notes.includes('fidgety') || notes.includes('restless')) {
    visualTraits.push('fidgety posture');
  }
  if (notes.includes('anxious') || notes.includes('nervous')) {
    visualTraits.push('anxious expression');
  }

  if (notes.includes('confident') || notes.includes('bold')) {
    visualTraits.push('confident stance');
  }
  if (notes.includes('proud') || notes.includes('arrogant')) {
    visualTraits.push('proud bearing');
  }

  if (notes.includes('shy') || notes.includes('timid')) {
    visualTraits.push('shy demeanor');
  }
  if (notes.includes('friendly') || notes.includes('warm')) {
    visualTraits.push('warm expression');
  }

  if (notes.includes('scar')) {
    visualTraits.push('visible scars');
  }
  if (notes.includes('tattoo')) {
    visualTraits.push('tattoos');
  }

  return visualTraits;
};

export const buildCharacterDescriptionSegment = (
  characterData: CharacterPromptData,
  extracted: ExtractedDetails,
): string => {
  const descParts: string[] = [];

  const raceDescription = characterData.subrace
    ? `${characterData.subrace} ${characterData.race || ''}`.trim()
    : characterData.race;

  if (raceDescription && characterData.class) {
    descParts.push(`${raceDescription} ${characterData.class}`);
  } else if (raceDescription) {
    descParts.push(raceDescription);
  } else if (characterData.class) {
    descParts.push(characterData.class);
  }

  if (extracted.physicalFeatures.length > 0) {
    descParts.push(extracted.physicalFeatures.join(', '));
  }

  const raceForPrompt = characterData.subrace || characterData.race;
  if (raceForPrompt) {
    descParts.push(getRacePrompt(raceForPrompt));
  }

  if (characterData.class) {
    descParts.push(getClassPrompt(characterData.class));
  }

  if (extracted.equipment.length > 0) {
    descParts.push(extracted.equipment.join(', '));
  }

  if (extracted.distinguishingMarks.length > 0) {
    descParts.push(extracted.distinguishingMarks.join(', '));
  }

  if (characterData.enhancementSelections && characterData.enhancementSelections.length > 0) {
    const enhancementVisuals = extractEnhancementVisuals(characterData.enhancementSelections);
    if (enhancementVisuals.length > 0) {
      descParts.push(enhancementVisuals.join(', '));
    }
  }

  if (characterData.enhancementEffects?.equipment?.length) {
    descParts.push(characterData.enhancementEffects.equipment.join(', '));
  }

  if (characterData.alignment) {
    descParts.push(getAlignmentPrompt(characterData.alignment));
  }

  const personalityVisuals = extractVisualPersonalityTraits(
    characterData.personality_notes || characterData.personality_traits,
  );
  if (personalityVisuals.length > 0) {
    descParts.push(personalityVisuals.join(', '));
  }

  return descParts.join(', ');
};

export const buildCharacterConcept = (
  characterData: CharacterPromptData,
  extracted: ExtractedDetails,
  theme: string,
): string => {
  const conceptParts: string[] = [];

  if (characterData.race && characterData.class) {
    conceptParts.push(`${characterData.race} ${characterData.class}`);
  } else if (characterData.race) {
    conceptParts.push(characterData.race);
  } else if (characterData.class) {
    conceptParts.push(characterData.class);
  }

  if (characterData.appearance) {
    conceptParts.push(characterData.appearance);
  }

  if (extracted.physicalFeatures.length > 0) {
    conceptParts.push(extracted.physicalFeatures.join(' '));
  }

  const outfitParts: string[] = [];
  if (characterClassToClassPrompt(characterData.class)) {
    outfitParts.push(getClassPrompt(characterData.class));
  }
  if (extracted.equipment.length > 0) {
    outfitParts.push(...extracted.equipment);
  }
  if (characterData.enhancementEffects?.equipment?.length) {
    outfitParts.push(...characterData.enhancementEffects.equipment);
  }
  const outfitSummary = summarizeOutfit(outfitParts);
  if (outfitSummary) {
    conceptParts.push(outfitSummary);
  }

  const weaponParts: string[] = [];
  if (characterData.class) {
    weaponParts.push(...extractWeaponsFromClass(characterData.class));
  }
  if (characterData.enhancementSelections?.length) {
    weaponParts.push(...extractWeaponsFromEnhancements(characterData.enhancementSelections));
  }
  const weaponSummary = summarizeWeapons(weaponParts);
  if (weaponSummary) {
    conceptParts.push(weaponSummary);
  }

  const personalityVisuals = extractVisualPersonalityTraits(
    characterData.personality_traits || characterData.personality_notes,
  );
  if (personalityVisuals.length > 0) {
    conceptParts.push(...personalityVisuals);
  }

  if (extracted.distinguishingMarks.length > 0) {
    conceptParts.push(...extracted.distinguishingMarks);
  }

  const fullConcept = conceptParts.join(', ');
  return `${fullConcept}, rendered in ${theme} theme, professional concept art style`;
};

// Helper for buildCharacterConcept to safely check for class
function characterClassToClassPrompt(charClass: Maybe<string>): charClass is string {
  return typeof charClass === 'string' && charClass.length > 0;
}
