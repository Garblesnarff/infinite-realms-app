/**
 * Character Description Prompts
 *
 * Prompt templates and context builders for generating and enhancing character descriptions.
 * Extracted from character-description-generator.ts for modularity.
 */

export interface CharacterData {
  name: string;
  description?: string | null;
  race?: string | null;
  subrace?: string | null;
  class?: string | null;
  background?: string | null;
  level?: number | null;
  ability_scores?: Record<string, number>;
  alignment?: string | null;
  personalityTraits?: string[];
  ideals?: string[];
  bonds?: string[];
  flaws?: string[];
  personality_notes?: string | null;
  enhancementSelections?: Array<{
    optionId: string;
    value: string | string[] | number;
    customValue?: string;
    aiGenerated?: boolean;
  }>;
  enhancementEffects?: {
    traits?: string[];
    skillBonus?: string[];
    abilityBonus?: Record<string, number>;
    languages?: string[];
    equipment?: string[];
  };
  // Physical traits - CRITICAL for accurate description generation
  gender?: 'male' | 'female' | null;
  age?: number | null;
  height?: number | null;
  weight?: number | null;
  eyes?: string | null;
  skin?: string | null;
  hair?: string | null;
}

export interface EnhancedDescription {
  description: string;
  appearance: string;
  personality_traits: string;
  backstory_elements: string;
}

export interface DescriptionOptions {
  enhanceExisting?: boolean; // true = enhance existing description, false = generate new
  includeBackstory?: boolean;
  includePersonality?: boolean;
  includeAppearance?: boolean;
  tone?: 'heroic' | 'dark' | 'comedic' | 'serious' | 'mysterious';
}

export class CharacterDescriptionPrompts {
  /**
   * Create a detailed prompt for character description generation
   */
  static buildDescriptionPrompt(
    characterData: CharacterData,
    options: DescriptionOptions = {},
  ): string {
    const {
      enhanceExisting = false,
      includeBackstory = true,
      includePersonality = true,
      includeAppearance = true,
      tone = 'heroic',
    } = options;

    const promptParts: string[] = [];

    // Base instruction
    if (enhanceExisting && characterData.description) {
      promptParts.push('<task>');
      promptParts.push(
        '  <instruction>Enhance and expand the following D&D character description with rich details</instruction>',
      );
      promptParts.push(`  <current_description>${characterData.description}</current_description>`);
      promptParts.push('</task>');
      promptParts.push('');
    } else {
      promptParts.push('<task>');
      promptParts.push(
        '  <instruction>Create a detailed D&D character description for the following character</instruction>',
      );
      promptParts.push('</task>');
      promptParts.push('');
    }

    // Character basics
    promptParts.push('<character_data>');
    promptParts.push(`  <name>${characterData.name}</name>`);
    if (characterData.race) promptParts.push(`  <race>${characterData.race}</race>`);
    if (characterData.subrace) promptParts.push(`  <subrace>${characterData.subrace}</subrace>`);
    if (characterData.class) promptParts.push(`  <class>${characterData.class}</class>`);
    if (characterData.background)
      promptParts.push(`  <background>${characterData.background}</background>`);
    if (characterData.level) promptParts.push(`  <level>${characterData.level}</level>`);
    if (characterData.alignment)
      promptParts.push(`  <alignment>${characterData.alignment}</alignment>`);

    // Add physical traits section - CRITICAL for accurate character representation
    const hasPhysicalTraits =
      characterData.gender ||
      characterData.age ||
      characterData.height ||
      characterData.weight ||
      characterData.eyes ||
      characterData.skin ||
      characterData.hair;

    if (hasPhysicalTraits) {
      promptParts.push('');
      promptParts.push('  <physical_traits>');
      if (characterData.gender)
        promptParts.push(`    <gender>${characterData.gender}</gender>`);
      if (characterData.age && characterData.age > 0)
        promptParts.push(`    <age>${characterData.age} years old</age>`);
      if (characterData.height && characterData.height > 0) {
        const totalInches = Math.round(characterData.height);
        const feet = Math.floor(totalInches / 12);
        const inches = totalInches - feet * 12;
        promptParts.push(`    <height>${feet}'${inches}" (${Math.round(totalInches * 2.54)} cm)</height>`);
      }
      if (characterData.weight && characterData.weight > 0) {
        promptParts.push(`    <weight>${Math.round(characterData.weight)} lbs (${Math.round(characterData.weight * 0.45)} kg)</weight>`);
      }
      if (characterData.eyes) promptParts.push(`    <eye_color>${characterData.eyes}</eye_color>`);
      if (characterData.skin) promptParts.push(`    <skin_tone>${characterData.skin}</skin_tone>`);
      if (characterData.hair) promptParts.push(`    <hair>${characterData.hair}</hair>`);
      promptParts.push('  </physical_traits>');
      promptParts.push('');
      promptParts.push(
        `  <critical_physical_requirements>MANDATORY: The character is ${characterData.gender || 'unspecified gender'}. ${characterData.gender ? `Use ONLY ${characterData.gender === 'female' ? 'she/her' : 'he/him'} pronouns throughout.` : ''} ${characterData.height ? `The character's height is EXACTLY ${Math.floor(characterData.height / 12)}'${Math.round(characterData.height) % 12}" - use this SPECIFIC measurement.` : ''} Do NOT invent different physical characteristics.</critical_physical_requirements>`,
      );
    }

    // Add personality elements if provided
    promptParts.push('');
    promptParts.push('  <personality>');
    if (characterData.personalityTraits && characterData.personalityTraits.length > 0) {
      const traits = characterData.personalityTraits.filter((trait) => trait.trim()).join('; ');
      if (traits) {
        promptParts.push(`    <traits>${traits}</traits>`);
      }
    }

    if (characterData.ideals && characterData.ideals.length > 0) {
      const ideals = characterData.ideals
        .filter((ideal) => typeof ideal === 'string' && ideal.trim())
        .join('; ');
      if (ideals) {
        promptParts.push(`    <ideals>${ideals}</ideals>`);
      }
    }

    if (characterData.bonds && characterData.bonds.length > 0) {
      const bonds = characterData.bonds
        .filter((bond) => typeof bond === 'string' && bond.trim())
        .join('; ');
      if (bonds) {
        promptParts.push(`    <bonds>${bonds}</bonds>`);
      }
    }

    if (characterData.flaws && characterData.flaws.length > 0) {
      const flaws = characterData.flaws
        .filter((flaw) => typeof flaw === 'string' && flaw.trim())
        .join('; ');
      if (flaws) {
        promptParts.push(`    <flaws>${flaws}</flaws>`);
      }
    }

    // Add personality notes if provided
    if (characterData.personality_notes) {
      promptParts.push(`    <notes>${characterData.personality_notes}</notes>`);
    }
    promptParts.push('  </personality>');

    // Instructions for using provided personality data
    if (
      (characterData.personalityTraits && characterData.personalityTraits.some((t) => t.trim())) ||
      (characterData.ideals && characterData.ideals.some((i) => i.trim())) ||
      (characterData.bonds && characterData.bonds.some((b) => b.trim())) ||
      (characterData.flaws && characterData.flaws.some((f) => f.trim())) ||
      characterData.personality_notes
    ) {
      promptParts.push('');
      promptParts.push(
        "  <important_note>Use the provided personality traits, ideals, bonds, and flaws EXACTLY as given. These are the character's defining characteristics and should be incorporated prominently into the description and personality section.</important_note>",
      );
    }

    // Add enhancement selections if provided
    if (characterData.enhancementSelections && characterData.enhancementSelections.length > 0) {
      promptParts.push('');
      promptParts.push('  <enhancements>');
      characterData.enhancementSelections.forEach((selection) => {
        if (Array.isArray(selection.value)) {
          promptParts.push(`    <enhancement>${selection.value.join(', ')}</enhancement>`);
        } else {
          promptParts.push(`    <enhancement>${selection.value}</enhancement>`);
        }
        if (selection.customValue) {
          promptParts.push(`    <note>${selection.customValue}</note>`);
        }
      });
      promptParts.push(
        "    <importance>These enhancements are core parts of the character's identity and should be prominently featured in the description, personality, and backstory</importance>",
      );
      promptParts.push('  </enhancements>');
    }

    // Add enhancement effects if provided
    if (characterData.enhancementEffects) {
      const effects = characterData.enhancementEffects;
      promptParts.push('');
      promptParts.push('  <enhancement_effects>');
      if (effects.traits && effects.traits.length > 0) {
        promptParts.push(`    <special_traits>${effects.traits.join(', ')}</special_traits>`);
      }
      if (effects.languages && effects.languages.length > 0) {
        promptParts.push(`    <languages>${effects.languages.join(', ')}</languages>`);
      }
      if (effects.equipment && effects.equipment.length > 0) {
        promptParts.push(`    <equipment>${effects.equipment.join(', ')}</equipment>`);
      }
      if (effects.skillBonus && effects.skillBonus.length > 0) {
        promptParts.push(`    <skill_bonuses>${effects.skillBonus.join(', ')}</skill_bonuses>`);
      }
      promptParts.push('  </enhancement_effects>');
    }

    // Add ability score context if available
    if (characterData.ability_scores) {
      const scores = characterData.ability_scores;
      promptParts.push('');
      promptParts.push('  <notable_abilities>');
      if (scores.strength >= 15) promptParts.push('    <strength>Strong and powerful</strength>');
      if (scores.dexterity >= 15) promptParts.push('    <dexterity>Agile and quick</dexterity>');
      if (scores.constitution >= 15)
        promptParts.push('    <constitution>Hardy and resilient</constitution>');
      if (scores.intelligence >= 15)
        promptParts.push('    <intelligence>Intelligent and clever</intelligence>');
      if (scores.wisdom >= 15) promptParts.push('    <wisdom>Wise and perceptive</wisdom>');
      if (scores.charisma >= 15)
        promptParts.push('    <charisma>Charismatic and compelling</charisma>');
      promptParts.push('  </notable_abilities>');
    }

    promptParts.push('</character_data>');
    promptParts.push('');

    // Tone specification
    promptParts.push(`<tone>Write in a ${tone} style appropriate for D&D fantasy setting</tone>`);

    // Verbalized Sampling for maximum creativity
    promptParts.push('');
    promptParts.push('<verbalized_sampling_technique>');
    promptParts.push('  <instruction>Before generating the final description, internally brainstorm 3-4 distinct character concept variations with probability scores (0.0-1.0) representing how typical each approach is</instruction>');
    promptParts.push('');
    promptParts.push('  <diversity_dimensions>');
    promptParts.push(`    <tone_variation>Vary interpretations of "${tone}" tone - from obvious to subtle to unexpected</tone_variation>`);
    promptParts.push('    <backstory_approach>Mix different backstory types: tragedy (prob: 0.7), triumph (prob: 0.6), mystery (prob: 0.4), redemption (prob: 0.5), wild card (prob: ≤0.3)</backstory_approach>');
    promptParts.push('    <personality_depth>Range from straightforward (0.8) to complex/contradictory (0.3)</personality_depth>');
    promptParts.push('    <uniqueness>From conventional representation (0.8) to subversive/unexpected take (0.25)</uniqueness>');
    promptParts.push('  </diversity_dimensions>');
    promptParts.push('');
    promptParts.push('  <example_process>');
    promptParts.push('    Internal brainstorming for a Dwarf Fighter:');
    promptParts.push('    1. Gruff, clan-loyal warrior (prob: 0.85) - Standard archetype');
    promptParts.push('    2. Exiled noble seeking redemption (prob: 0.60) - Emotional depth');
    promptParts.push('    3. Cheerful optimist who loves cooking (prob: 0.35) - Personality twist');
    promptParts.push('    4. Former scholar turned warrior (prob: 0.25) - Background subversion');
    promptParts.push('');
    promptParts.push('    Select the most compelling concept that balances creativity with authenticity');
    promptParts.push('  </example_process>');
    promptParts.push('');
    promptParts.push('  <selection_criteria>Choose the concept that:');
    promptParts.push('    - Best fits the character data provided');
    promptParts.push('    - Offers the most interesting roleplay potential');
    promptParts.push('    - Avoids clichés while remaining believable');
    promptParts.push('    - Creates natural story hooks for adventures');
    promptParts.push('  </selection_criteria>');
    promptParts.push('</verbalized_sampling_technique>');

    // Output format requirements
    promptParts.push('');
    promptParts.push('<output_format>');
    promptParts.push(
      '  <instruction>Please provide the following sections with EXACT formatting using bold markdown headers:</instruction>',
    );
    promptParts.push('');
    promptParts.push(
      '  <section name="DESCRIPTION">A comprehensive overview of the character (2-3 sentences)</section>',
    );
    promptParts.push('');

    if (includeAppearance) {
      promptParts.push(
        '  <section name="APPEARANCE">Detailed physical description including height, build, facial features, hair, eyes, scars, tattoos, and clothing style (3-4 sentences)</section>',
      );
      promptParts.push('');
    }

    if (includePersonality) {
      promptParts.push(
        '  <section name="PERSONALITY">Character traits, mannerisms, speech patterns, motivations, fears, and quirks (3-4 sentences)</section>',
      );
      promptParts.push('');
    }

    if (includeBackstory) {
      promptParts.push(
        '  <section name="BACKSTORY">Brief background story explaining how they became who they are, their origins, and what drives them to adventure (3-4 sentences)</section>',
      );
      promptParts.push('');
    }

    promptParts.push(
      '  <important>Always start each section with the bold header format shown above (e.g., **DESCRIPTION:**). Include all four section headers even if some sections are brief.</important>',
    );
    promptParts.push('</output_format>');

    // D&D-specific guidelines
    promptParts.push('');
    promptParts.push('<guidelines>');
    promptParts.push('  <guideline>Use D&D 5E lore and terminology</guideline>');
    promptParts.push(
      '  <guideline>Make the character feel authentic to their SPECIFIED race and subrace (if provided)</guideline>',
    );
    promptParts.push(
      '  <guideline>Include specific details that make the character unique</guideline>',
    );
    promptParts.push(
      '  <guideline>Ensure the personality matches their background and alignment</guideline>',
    );
    promptParts.push('  <guideline>Create hooks for future roleplay and storytelling</guideline>');
    promptParts.push(
      '  <guideline>NEVER assume details not explicitly provided (e.g., do not assume Hill Dwarf if only Dwarf is specified)</guideline>',
    );
    promptParts.push(
      '  <guideline>Only use the specific subrace if explicitly provided in the character data</guideline>',
    );
    promptParts.push(
      '  <guideline>Base descriptions strictly on the provided information without making assumptions</guideline>',
    );
    promptParts.push(
      '  <guideline>CRITICAL: If gender is specified, use the CORRECT pronouns throughout (she/her for female, he/him for male). Never mix genders.</guideline>',
    );
    promptParts.push(
      '  <guideline>CRITICAL: Use the EXACT height provided in physical_traits. Do not exaggerate or invent different heights.</guideline>',
    );
    promptParts.push(
      '  <guideline>CRITICAL: All physical traits (age, height, weight, eye color, skin tone, hair) must match the provided data exactly.</guideline>',
    );
    promptParts.push('</guidelines>');

    return promptParts.join('\n');
  }

  /**
   * Create a prompt for generating a quick character description
   */
  static buildQuickDescriptionPrompt(characterData: CharacterData): string {
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
}
