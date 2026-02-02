import type {
  Maybe,
  CharacterPromptData,
  ExtractedDetails,
  EnhancementSelection,
  ImagePromptOptions,
} from './character-prompt-types';

export const INCH_TO_CM = 2.54;
export const POUND_TO_KG = 0.45359237;

export const isPositiveNumber = (value: Maybe<number>): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const formatHeightForPrompt = (height: Maybe<number>): string | null => {
  if (!isPositiveNumber(height)) return null;
  const totalInches = Math.round(height);
  const feet = Math.floor(totalInches / 12);
  const remainingInches = totalInches - feet * 12;
  const cm = Math.round(totalInches * INCH_TO_CM);
  const imperial = `${feet}'${remainingInches}"`;
  const metric = `${cm} cm`;
  return `${imperial} (${metric})`;
};

export const formatWeightForPrompt = (weight: Maybe<number>): string | null => {
  if (!isPositiveNumber(weight)) return null;
  const lbs = Math.round(weight);
  const kg = Math.round(weight * POUND_TO_KG);
  return `${lbs} lbs (${kg} kg)`;
};

export const buildPhysicalTraitLines = (data: CharacterPromptData): string[] => {
  const lines: string[] = [];
  const height = formatHeightForPrompt(data.height);
  const weight = formatWeightForPrompt(data.weight);

  if (data.gender) lines.push(`Gender: ${data.gender}`);
  if (data.age && data.age > 0) lines.push(`Age: ${data.age} years old`);
  if (height) lines.push(`Height: ${height}`);
  if (weight) lines.push(`Weight: ${weight}`);
  if (data.eyes?.trim()) lines.push(`Eye Color: ${data.eyes.trim()}`);
  if (data.skin?.trim()) lines.push(`Skin Tone: ${data.skin.trim()}`);
  if (data.hair?.trim()) lines.push(`Hair: ${data.hair.trim()}`);
  return lines;
};

export const appendPhysicalTraitsDescriptionPrompt = (
  parts: string[],
  data: CharacterPromptData,
): void => {
  const lines = buildPhysicalTraitLines(data);
  if (lines.length === 0) return;

  parts.push('\nPhysical Traits (MANDATORY):');
  lines.forEach((line) => parts.push(`- ${line}`));
  parts.push(
    'IMPORTANT: The APPEARANCE section must exactly match these mandatory physical traits, including measurements and colors. Do not invent alternatives.',
  );
};

export const appendPhysicalTraitsImagePrompt = (
  parts: string[],
  data: CharacterPromptData,
): void => {
  const lines = buildPhysicalTraitLines(data);
  if (lines.length === 0) return;

  parts.push(
    `exact physical traits: ${lines.join('; ')}. strictly follow these measurements and colors without deviation.`,
  );
};

export const sanitize = (value: Maybe<string>): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const listFrom = (values: Maybe<string[] | string>): string[] => {
  if (!values) return [];
  if (Array.isArray(values))
    return values
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim());
  return values
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

export const extractCharacterDetails = (characterData: CharacterPromptData): ExtractedDetails => {
  const details: ExtractedDetails = {
    physicalFeatures: [],
    equipment: [],
    distinguishingMarks: [],
  };

  if (characterData.appearance) {
    const appearance = characterData.appearance.toLowerCase();

    if (appearance.includes('tall')) details.physicalFeatures.push('tall stature');
    if (appearance.includes('short')) details.physicalFeatures.push('short stature');
    if (appearance.includes('muscular')) details.physicalFeatures.push('muscular build');
    if (appearance.includes('lean')) details.physicalFeatures.push('lean build');
    if (appearance.includes('stocky')) details.physicalFeatures.push('stocky build');

    if (appearance.includes('brown hair')) details.physicalFeatures.push('brown hair');
    if (appearance.includes('black hair')) details.physicalFeatures.push('black hair');
    if (appearance.includes('blonde hair')) details.physicalFeatures.push('blonde hair');
    if (appearance.includes('red hair')) details.physicalFeatures.push('red hair');
    if (appearance.includes('white hair')) details.physicalFeatures.push('white hair');
    if (appearance.includes('braid')) details.physicalFeatures.push('braided hair');

    if (appearance.includes('blue eyes')) details.physicalFeatures.push('blue eyes');
    if (appearance.includes('green eyes')) details.physicalFeatures.push('green eyes');
    if (appearance.includes('brown eyes')) details.physicalFeatures.push('brown eyes');
    if (appearance.includes('piercing eyes')) details.physicalFeatures.push('piercing gaze');

    if (appearance.includes('scar')) details.distinguishingMarks.push('battle scars');
    if (appearance.includes('tattoo')) details.distinguishingMarks.push('tattoos');

    if (appearance.includes('leather armor')) details.equipment.push('leather armor');
    if (appearance.includes('plate armor')) details.equipment.push('plate armor');
    if (appearance.includes('chainmail')) details.equipment.push('chainmail');
    if (appearance.includes('surcoat')) details.equipment.push('surcoat');
  }

  const traits = buildPhysicalTraitLines(characterData);
  traits.forEach((trait) => details.physicalFeatures.push(trait.toLowerCase()));

  return details;
};

export const getRacePrompt = (race: string): string => {
  const raceMap: Record<string, string> = {
    human: 'human features with varied skin tones and expressive face',
    elf: 'elven features with pointed ears, graceful build, and ethereal beauty',
    dwarf: 'dwarven features with stocky build, beard, and sturdy appearance',
    halfling: 'halfling features with small stature and cheerful expression',
    dragonborn: 'dragonborn features with draconic scales and proud bearing',
    gnome: 'gnomish features with small size and mischievous expression',
    'half-elf': 'half-elf features blending human and elven traits',
    'half-orc': 'half-orc features with tusks and muscular build',
    tiefling: 'tiefling features with horns, tail, and infernal heritage',
    celestialborn: 'celestialborn features with divine radiance',
    elementalborn: 'elementalborn features with elemental manifestations',
    catfolk: 'catfolk features with feline characteristics and agility',
    ravenfolk: 'ravenfolk features with avian characteristics',
    lizardfolk: 'lizardfolk features with reptilian scales',
    tortle: 'tortle features with turtle shell and wise expression',
    'high elf': 'high elven features with pointed ears, refined bearing, and arcane elegance',
    'wood elf':
      'wood elven features with pointed ears, natural grace, and forest-dwelling appearance',
    'dark elf': 'dark elven features with pointed ears, pale or dark skin, and mysterious aura',
    drow: 'drow features with pointed ears, dark skin, white hair, and underground nobility',
    'mountain dwarf':
      'mountain dwarven features with stocky build, thick beard, and hardy mountain appearance',
    'hill dwarf':
      'hill dwarven features with stocky build, well-groomed beard, and pastoral strength',
    'lightfoot halfling':
      'lightfoot halfling features with small stature, nimble build, and wandering spirit',
    'stout halfling':
      'stout halfling features with small but robust build and determined expression',
    'variant human':
      'human features with varied skin tones, expressive face, and adaptable appearance',
    'forest gnome':
      'forest gnomish features with small size, nature-connected appearance, and woodland charm',
    'rock gnome':
      'rock gnomish features with small size, tinker-focused hands, and inventive expression',
    'asmodeus tiefling':
      'tiefling features with prominent horns, forked tail, and regal infernal heritage',
    'zariel tiefling':
      'tiefling features with warrior-like horns, strong tail, and martial infernal bearing',
  };

  return raceMap[race.toLowerCase()] || `${race.toLowerCase()} racial features`;
};

export const getClassPrompt = (characterClass: string): string => {
  const classMap: Record<string, string> = {
    barbarian: 'wearing animal pelts and tribal markings',
    bard: 'wearing colorful clothing with artistic accessories',
    cleric: 'wearing religious vestments with holy symbol',
    druid: 'wearing natural materials in earth tones',
    fighter: 'wearing practical armor with martial equipment',
    monk: 'wearing simple robes for martial arts',
    paladin: 'wearing shining armor with holy symbols',
    ranger: 'wearing leather armor with nature camouflage',
    rogue: 'wearing dark clothing with stealth tools',
    sorcerer: 'with innate magic aura and arcane symbols',
    warlock: 'with eldritch energy and occult accessories',
    wizard: 'wearing scholarly robes with spellbook',
    artificer: 'with mechanical gadgets and crafting tools',
    'blood hunter': 'with scarred appearance and hunter gear',
  };

  return classMap[characterClass.toLowerCase()] || `${characterClass.toLowerCase()} class attire`;
};

export const getAlignmentPrompt = (alignment: string): string => {
  const alignmentMap: Record<string, string> = {
    'lawful good': 'noble and righteous expression',
    'neutral good': 'kind and compassionate expression',
    'chaotic good': 'free-spirited and good-hearted expression',
    'lawful neutral': 'disciplined and orderly expression',
    'true neutral': 'balanced and pragmatic expression',
    'chaotic neutral': 'unpredictable and wild expression',
    'lawful evil': 'controlled and calculating expression',
    'neutral evil': 'selfish and opportunistic expression',
    'chaotic evil': 'malevolent and destructive expression',
  };

  return alignmentMap[alignment.toLowerCase()] || 'balanced expression';
};

export const extractEnhancementVisuals = (enhancementSelections: EnhancementSelection[]): string[] => {
  const visualElements: string[] = [];

  enhancementSelections.forEach((selection) => {
    const value = Array.isArray(selection.value)
      ? selection.value.join(' ')
      : String(selection.value);
    const combined = `${value} ${selection.customValue || ''}`.toLowerCase();

    if (combined.includes('scar')) visualElements.push('distinctive scars');
    if (combined.includes('tattoo')) visualElements.push('meaningful tattoos');
    if (combined.includes('piercing')) visualElements.push('piercings');
    if (combined.includes('jewelry') || combined.includes('ring') || combined.includes('necklace'))
      visualElements.push('distinctive jewelry');
    if (
      combined.includes('weapon') ||
      combined.includes('sword') ||
      combined.includes('axe') ||
      combined.includes('bow')
    )
      visualElements.push('special weapon');
    if (combined.includes('armor') || combined.includes('shield'))
      visualElements.push('unique armor');
    if (combined.includes('cloak') || combined.includes('cape') || combined.includes('robe'))
      visualElements.push('distinctive clothing');
    if (combined.includes('mark') || combined.includes('brand') || combined.includes('symbol'))
      visualElements.push('mystical markings');
    if (combined.includes('aura') || combined.includes('glow') || combined.includes('magic'))
      visualElements.push('magical aura');
    if (combined.includes('eye') || combined.includes('gaze')) visualElements.push('striking eyes');
    if (combined.includes('hair') || combined.includes('beard'))
      visualElements.push('distinctive hair');
    if (combined.includes('posture') || combined.includes('stance'))
      visualElements.push('unique posture');
    if (combined.includes('familiar') || combined.includes('companion') || combined.includes('pet'))
      visualElements.push('animal companion');
  });

  return [...new Set(visualElements)];
};

export const extractVisualPersonalityTraits = (personalityText: Maybe<string>): string[] => {
  if (!personalityText) return [];
  const notes = personalityText.toLowerCase();
  const visualTraits: string[] = [];

  if (notes.includes('tourettes') || notes.includes('tics'))
    visualTraits.push('subtle facial tics');
  if (notes.includes('fidgety') || notes.includes('restless')) visualTraits.push('fidgety posture');
  if (notes.includes('anxious') || notes.includes('nervous'))
    visualTraits.push('anxious expression');

  if (notes.includes('confident') || notes.includes('bold')) visualTraits.push('confident stance');
  if (notes.includes('proud') || notes.includes('arrogant')) visualTraits.push('proud bearing');

  if (notes.includes('shy') || notes.includes('timid')) visualTraits.push('shy demeanor');
  if (notes.includes('friendly') || notes.includes('warm')) visualTraits.push('warm expression');

  if (notes.includes('scar')) visualTraits.push('visible scars');
  if (notes.includes('tattoo')) visualTraits.push('tattoos');

  return visualTraits;
};

export const extractWeaponsFromClass = (characterClass: string): string[] => {
  const classWeaponsMap: Record<string, string[]> = {
    barbarian: ['greataxe', 'battleaxe'],
    fighter: ['longsword', 'shield'],
    paladin: ['longsword', 'mace', 'shield'],
    ranger: ['longbow', 'shortsword'],
    rogue: ['rapier', 'dagger'],
    bard: ['rapier', 'dagger'],
    cleric: ['mace', 'shield'],
    druid: ['quarterstaff', 'scimitar'],
    monk: ['quarterstaff', 'unarmed strikes'],
    sorcerer: ['light crossbow', 'dagger'],
    warlock: ['light crossbow', 'eldritch blast'],
    wizard: ['quarterstaff', 'dagger'],
    artificer: ['hand crossbow', 'simple weapon'],
    'blood hunter': ['greatsword', 'hand crossbow'],
  };

  const weapons = classWeaponsMap[characterClass.toLowerCase()] || ['appropriate weapons'];
  return weapons;
};

export const extractWeaponsFromEnhancements = (
  enhancementSelections: EnhancementSelection[],
): string[] => {
  const weapons: string[] = [];

  enhancementSelections.forEach((selection) => {
    const value = Array.isArray(selection.value)
      ? selection.value.join(' ')
      : String(selection.value);
    const combined = `${value} ${selection.customValue || ''}`.toLowerCase();

    if (combined.includes('sword') || combined.includes('blade')) weapons.push('sword');
    if (combined.includes('axe')) weapons.push('axe');
    if (combined.includes('bow') || combined.includes('arrow')) weapons.push('bow');
    if (combined.includes('dagger') || combined.includes('knife')) weapons.push('dagger');
    if (combined.includes('mace') || combined.includes('hammer')) weapons.push('mace');
    if (combined.includes('staff') || combined.includes('quarterstaff'))
      weapons.push('quarterstaff');
    if (combined.includes('crossbow')) weapons.push('crossbow');
    if (combined.includes('spear') || combined.includes('lance')) weapons.push('spear');
  });

  return [...new Set(weapons)];
};

export const summarizeOutfit = (outfitParts: string[]): string => {
  if (outfitParts.length === 0) return '';

  const armorTypes = outfitParts.filter(
    (part) =>
      part.includes('armor') ||
      part.includes('chainmail') ||
      part.includes('plate') ||
      part.includes('leather'),
  );
  const clothingTypes = outfitParts.filter(
    (part) =>
      part.includes('robe') ||
      part.includes('cloak') ||
      part.includes('vestments') ||
      part.includes('clothing'),
  );
  const accessories = outfitParts.filter(
    (part) =>
      part.includes('symbol') ||
      part.includes('focus') ||
      part.includes('instrument') ||
      part.includes('book'),
  );

  const summaryParts: string[] = [];

  if (armorTypes.length > 0) summaryParts.push(armorTypes[0].split(' with ')[0]);
  if (clothingTypes.length > 0) summaryParts.push(clothingTypes[0]);
  if (accessories.length > 0) summaryParts.push(accessories[0]);

  return summaryParts.length > 0 ? `wearing ${summaryParts.join(' and ')}` : '';
};

export const summarizeWeapons = (weaponParts: string[]): string => {
  if (weaponParts.length === 0) return '';

  const primaryWeapons = weaponParts.filter(
    (w) => w.includes('sword') || w.includes('axe') || w.includes('staff') || w.includes('bow'),
  );
  const summary =
    primaryWeapons.length > 0
      ? `armed with ${primaryWeapons.join(' and ')}`
      : `armed with ${weaponParts[0]}`;

  return summary;
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
    if (enhancementVisuals.length > 0) descParts.push(enhancementVisuals.join(', '));
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
  if (characterData.class) {
    outfitParts.push(getClassPrompt(characterData.class));
  }
  if (extracted.equipment.length > 0) {
    outfitParts.push(...extracted.equipment);
  }
  if (characterData.enhancementEffects?.equipment?.length) {
    outfitParts.push(...characterData.enhancementEffects.equipment);
  }
  const outfitSummary = summarizeOutfit(outfitParts);
  if (outfitSummary) conceptParts.push(outfitSummary);

  const weaponParts: string[] = [];
  if (characterData.class) {
    weaponParts.push(...extractWeaponsFromClass(characterData.class));
  }
  if (characterData.enhancementSelections?.length) {
    weaponParts.push(...extractWeaponsFromEnhancements(characterData.enhancementSelections));
  }
  const weaponSummary = summarizeWeapons(weaponParts);
  if (weaponSummary) conceptParts.push(weaponSummary);

  const personalityVisuals = extractVisualPersonalityTraits(
    characterData.personality_traits || characterData.personality_notes,
  );
  if (personalityVisuals.length > 0) conceptParts.push(...personalityVisuals);

  if (extracted.distinguishingMarks.length > 0) conceptParts.push(...extracted.distinguishingMarks);

  const fullConcept = conceptParts.join(', ');
  return `${fullConcept}, rendered in ${theme} theme, professional concept art style`;
};

export const getArtStylePrompt = (artStyle: ImagePromptOptions['artStyle']): string => {
  const styleMap: Record<ImagePromptOptions['artStyle'], string> = {
    'fantasy-art': 'fantasy art style, detailed digital painting, epic fantasy aesthetic',
    anime: 'anime art style, cel-shaded, Japanese animation style, vibrant colors',
    realistic: 'photorealistic style, highly detailed, lifelike rendering',
    'comic-book': 'comic book art style, bold lines, dynamic shading, superhero aesthetic',
    watercolor: 'watercolor painting style, soft washes, artistic brushstrokes',
    sketch: 'pencil sketch style, hand-drawn, artistic line work, monochromatic',
    'oil-painting': 'oil painting style, classical art, rich textures, masterwork quality',
  };

  return styleMap[artStyle];
};
