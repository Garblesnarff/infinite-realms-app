/**
 * Character Description Prompt Templates
 *
 * XML-style prompt block templates extracted from character-description-prompts.ts for modularity.
 */

/**
 * Returns the verbalized sampling technique prompt block for character descriptions.
 *
 * @param tone The tone style for the character description (e.g., 'heroic', 'dark')
 */
export function getVerbalizedSamplingTemplate(tone: string): string[] {
  return [
    '<verbalized_sampling_technique>',
    '  <instruction>Before generating the final description, internally brainstorm 3-4 distinct character concept variations with probability scores (0.0-1.0) representing how typical each approach is</instruction>',
    '',
    '  <diversity_dimensions>',
    `    <tone_variation>Vary interpretations of "${tone}" tone - from obvious to subtle to unexpected</tone_variation>`,
    '    <backstory_approach>Mix different backstory types: tragedy (prob: 0.7), triumph (prob: 0.6), mystery (prob: 0.4), redemption (prob: 0.5), wild card (prob: ≤0.3)</backstory_approach>',
    '    <personality_depth>Range from straightforward (0.8) to complex/contradictory (0.3)</personality_depth>',
    '    <uniqueness>From conventional representation (0.8) to subversive/unexpected take (0.25)</uniqueness>',
    '  </diversity_dimensions>',
    '',
    '  <example_process>',
    '    Internal brainstorming for a Dwarf Fighter:',
    '    1. Gruff, clan-loyal warrior (prob: 0.85) - Standard archetype',
    '    2. Exiled noble seeking redemption (prob: 0.60) - Emotional depth',
    '    3. Cheerful optimist who loves cooking (prob: 0.35) - Personality twist',
    '    4. Former scholar turned warrior (prob: 0.25) - Background subversion',
    '',
    '    Select the most compelling concept that balances creativity with authenticity',
    '  </example_process>',
    '',
    '  <selection_criteria>Choose the concept that:',
    '    - Best fits the character data provided',
    '    - Offers the most interesting roleplay potential',
    '    - Avoids clichés while remaining believable',
    '    - Creates natural story hooks for adventures',
    '  </selection_criteria>',
    '</verbalized_sampling_technique>',
  ];
}

/**
 * Returns the output format prompt block based on specified sections.
 */
export function getOutputFormatTemplate(
  includeAppearance: boolean,
  includePersonality: boolean,
  includeBackstory: boolean,
): string[] {
  const parts: string[] = [
    '<output_format>',
    '  <instruction>Please provide the following sections with EXACT formatting using bold markdown headers:</instruction>',
    '',
    '  <section name="DESCRIPTION">A comprehensive overview of the character (2-3 sentences)</section>',
    '',
  ];

  if (includeAppearance) {
    parts.push(
      '  <section name="APPEARANCE">Detailed physical description including height, build, facial features, hair, eyes, scars, tattoos, and clothing style (3-4 sentences)</section>',
      '',
    );
  }

  if (includePersonality) {
    parts.push(
      '  <section name="PERSONALITY">Character traits, mannerisms, speech patterns, motivations, fears, and quirks (3-4 sentences)</section>',
      '',
    );
  }

  if (includeBackstory) {
    parts.push(
      '  <section name="BACKSTORY">Brief background story explaining how they became who they are, their origins, and what drives them to adventure (3-4 sentences)</section>',
      '',
    );
  }

  parts.push(
    '  <important>Always start each section with the bold header format shown above (e.g., **DESCRIPTION:**). Include all four section headers even if some sections are brief.</important>',
    '</output_format>',
  );

  return parts;
}

/**
 * Static guidelines template for character description generation.
 */
export const CHARACTER_GUIDELINES_TEMPLATE: string[] = [
  '<guidelines>',
  '  <guideline>Use D&D 5E lore and terminology</guideline>',
  '  <guideline>Make the character feel authentic to their SPECIFIED race and subrace (if provided)</guideline>',
  '  <guideline>Include specific details that make the character unique</guideline>',
  '  <guideline>Ensure the personality matches their background and alignment</guideline>',
  '  <guideline>Create hooks for future roleplay and storytelling</guideline>',
  '  <guideline>NEVER assume details not explicitly provided (e.g., do not assume Hill Dwarf if only Dwarf is specified)</guideline>',
  '  <guideline>Only use the specific subrace if explicitly provided in the character data</guideline>',
  '  <guideline>Base descriptions strictly on the provided information without making assumptions</guideline>',
  '  <guideline>CRITICAL: If gender is specified, use the CORRECT pronouns throughout (she/her for female, he/him for male). Never mix genders.</guideline>',
  '  <guideline>CRITICAL: Use the EXACT height provided in physical_traits. Do not exaggerate or invent different heights.</guideline>',
  '  <guideline>CRITICAL: All physical traits (age, height, weight, eye color, skin tone, hair) must match the provided data exactly.</guideline>',
  '</guidelines>',
];

/**
 * Returns a quick character description prompt block.
 */
export function getQuickDescriptionTemplate(characterData: {
  name: string;
  race?: string | null;
  class?: string | null;
  background?: string | null;
  enhancementSelections?: Array<{ value: string | string[] | number }>;
}): string {
  const enhancementText =
    characterData.enhancementSelections && characterData.enhancementSelections.length > 0
      ? `\n  <special_traits>${characterData.enhancementSelections.map((s) => (Array.isArray(s.value) ? s.value.join(', ') : s.value)).join('; ')}</special_traits>`
      : '';

  return `<task>
  <instruction>Create a brief, engaging description (1-2 sentences) for this D&D character</instruction>
</task>

<character_data>
  <name>${characterData.name}</name>
  <race>${characterData.race || 'Human'}</race>
  <class>${characterData.class || 'Adventurer'}</class>
  <background>${characterData.background || 'Unknown'}</background>${enhancementText}
</character_data>

<requirements>
  <requirement>Make it exciting and suitable for a character card</requirement>
  <requirement>If special traits are provided, incorporate them prominently</requirement>
</requirements>`;
}
