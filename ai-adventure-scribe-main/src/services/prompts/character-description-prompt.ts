import {
  appendPhysicalTraitsDescriptionPrompt,
  sanitize,
  listFrom,
} from './character-prompt-helpers';

import type {
  CharacterPromptData,
  DescriptionPromptOptions,
} from './character-prompt-types';

export const buildCharacterDescriptionPrompt = (
  characterData: CharacterPromptData,
  options: DescriptionPromptOptions = {},
): string => {
  const {
    enhanceExisting = false,
    includeBackstory = true,
    includePersonality = true,
    includeAppearance = true,
    tone = 'heroic',
  } = options;

  const promptParts: string[] = [];

  if (enhanceExisting && characterData.description) {
    promptParts.push(
      'Enhance and expand the following D&D character description with rich details:',
    );
    promptParts.push(`Current description: "${characterData.description}"`);
  } else {
    promptParts.push('Create a detailed D&D character description for the following character:');
  }

  const name = sanitize(characterData.name) || 'Unnamed Character';
  promptParts.push(`Character Name: ${name}`);
  const race = sanitize(characterData.race);
  const subrace = sanitize(characterData.subrace);
  const charClass = sanitize(characterData.class);
  const background = sanitize(characterData.background);
  const alignment = sanitize(characterData.alignment);

  if (race) promptParts.push(`Race: ${race}`);
  if (subrace) promptParts.push(`Subrace: ${subrace}`);
  if (charClass) promptParts.push(`Class: ${charClass}`);
  if (background) promptParts.push(`Background: ${background}`);
  if (characterData.level) promptParts.push(`Level: ${characterData.level}`);
  if (alignment) promptParts.push(`Alignment: ${alignment}`);

  const traits = listFrom(characterData.personalityTraits);
  if (traits.length > 0) promptParts.push(`Personality Traits: ${traits.join('; ')}`);

  const ideals = listFrom(characterData.ideals);
  if (ideals.length > 0) promptParts.push(`Ideals: ${ideals.join('; ')}`);

  const bonds = listFrom(characterData.bonds);
  if (bonds.length > 0) promptParts.push(`Bonds: ${bonds.join('; ')}`);

  const flaws = listFrom(characterData.flaws);
  if (flaws.length > 0) promptParts.push(`Flaws: ${flaws.join('; ')}`);

  const personalityNotes = sanitize(characterData.personality_notes);
  if (personalityNotes) promptParts.push(`Additional Personality Notes: ${personalityNotes}`);

  if (
    traits.length > 0 ||
    ideals.length > 0 ||
    bonds.length > 0 ||
    flaws.length > 0 ||
    personalityNotes
  ) {
    promptParts.push(
      "(IMPORTANT: Use the provided personality traits, ideals, bonds, and flaws EXACTLY as given. These are the character's defining characteristics and should be incorporated prominently into the description and personality section)",
    );
  }

  if (characterData.enhancementSelections && characterData.enhancementSelections.length > 0) {
    promptParts.push('\nCharacter Enhancements:');
    characterData.enhancementSelections.forEach((selection) => {
      if (Array.isArray(selection.value)) {
        promptParts.push(`- ${selection.value.join(', ')}`);
      } else {
        promptParts.push(`- ${selection.value}`);
      }
      if (selection.customValue) promptParts.push(`  Note: ${selection.customValue}`);
    });
    promptParts.push(
      "(These enhancements are core parts of the character's identity and should be prominently featured in the description, personality, and backstory)",
    );
  }

  if (characterData.enhancementEffects) {
    const effects = characterData.enhancementEffects;
    if (effects.traits?.length) promptParts.push(`Special Traits: ${effects.traits.join(', ')}`);
    if (effects.languages?.length)
      promptParts.push(`Additional Languages: ${effects.languages.join(', ')}`);
    if (effects.equipment?.length)
      promptParts.push(`Special Equipment: ${effects.equipment.join(', ')}`);
    if (effects.skillBonus?.length)
      promptParts.push(`Skill Bonuses: ${effects.skillBonus.join(', ')}`);
  }

  if (characterData.ability_scores) {
    const scores = characterData.ability_scores;
    promptParts.push('Notable ability scores:');
    if ((scores.strength ?? 0) >= 15) promptParts.push('- Strong and powerful');
    if ((scores.dexterity ?? 0) >= 15) promptParts.push('- Agile and quick');
    if ((scores.constitution ?? 0) >= 15) promptParts.push('- Hardy and resilient');
    if ((scores.intelligence ?? 0) >= 15) promptParts.push('- Intelligent and clever');
    if ((scores.wisdom ?? 0) >= 15) promptParts.push('- Wise and perceptive');
    if ((scores.charisma ?? 0) >= 15) promptParts.push('- Charismatic and compelling');
  }

  appendPhysicalTraitsDescriptionPrompt(promptParts, characterData);

  promptParts.push(`Tone: Write in a ${tone} style appropriate for D&D fantasy setting.`);

  promptParts.push(
    '\nPlease provide the following sections with EXACT formatting using bold markdown headers:',
  );
  promptParts.push('');
  promptParts.push('**DESCRIPTION:** A comprehensive overview of the character (2-3 sentences)');
  promptParts.push('');

  if (includeAppearance) {
    promptParts.push(
      '**APPEARANCE:** Detailed physical description including height, build, facial features, hair, eyes, scars, tattoos, and clothing style (3-4 sentences)',
    );
    promptParts.push('');
  }

  if (includePersonality) {
    promptParts.push(
      '**PERSONALITY:** Character traits, mannerisms, speech patterns, motivations, fears, and quirks (3-4 sentences)',
    );
    promptParts.push('');
  }

  if (includeBackstory) {
    promptParts.push(
      '**BACKSTORY:** Brief background story explaining how they became who they are, their origins, and what drives them to adventure (3-4 sentences)',
    );
    promptParts.push('');
  }

  promptParts.push(
    'IMPORTANT: Always start each section with the bold header format shown above (e.g., **DESCRIPTION:**). Include all four section headers even if some sections are brief.',
  );

  promptParts.push('\nGuidelines:');
  promptParts.push('- Use D&D 5E lore and terminology');
  promptParts.push(
    '- Make the character feel authentic to their SPECIFIED race and subrace (if provided)',
  );
  promptParts.push('- Include specific details that make the character unique');
  promptParts.push('- Ensure the personality matches their background and alignment');
  promptParts.push('- Create hooks for future roleplay and storytelling');
  promptParts.push(
    '- NEVER assume details not explicitly provided (e.g., do not assume Hill Dwarf if only Dwarf is specified)',
  );
  promptParts.push('- Only use the specific subrace if explicitly provided in the character data');
  promptParts.push(
    '- Base descriptions strictly on the provided information without making assumptions',
  );

  return promptParts.join('\n');
};
