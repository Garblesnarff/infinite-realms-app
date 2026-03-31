import type {
  Maybe,
  CharacterPromptData,
  ImagePromptOptions,
} from './character-prompt-types';

export {
  extractCharacterDetails,
  extractEnhancementVisuals,
  extractVisualPersonalityTraits,
  extractWeaponsFromClass,
  extractWeaponsFromEnhancements,
  summarizeOutfit,
  summarizeWeapons,
  buildCharacterDescriptionSegment,
  buildCharacterConcept,
} from './character-prompt-extractors';

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
