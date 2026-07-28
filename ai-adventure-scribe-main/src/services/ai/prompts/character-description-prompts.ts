/**
 * Character Description Prompts
 *
 * Prompt templates and context builders for generating and enhancing character descriptions.
 * Extracted from character-description-generator.ts for modularity.
 */

import {
  getVerbalizedSamplingTemplate,
  getOutputFormatTemplate,
  CHARACTER_GUIDELINES_TEMPLATE,
  getQuickDescriptionTemplate,
} from './character-description-templates';

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
      if (characterData.gender) promptParts.push(`    <gender>${characterData.gender}</gender>`);
      if (characterData.age && characterData.age > 0)
        promptParts.push(`    <age>${characterData.age} years old</age>`);
      if (characterData.height && characterData.height > 0) {
        const totalInches = Math.round(characterData.height);
        const feet = Math.floor(totalInches / 12);
        const inches = totalInches - feet * 12;
        promptParts.push(
          `    <height>${feet}'${inches}" (${Math.round(totalInches * 2.54)} cm)</height>`,
        );
      }
      if (characterData.weight && characterData.weight > 0) {
        promptParts.push(
          `    <weight>${Math.round(characterData.weight)} lbs (${Math.round(characterData.weight * 0.45)} kg)</weight>`,
        );
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
    promptParts.push(...getVerbalizedSamplingTemplate(tone));

    // Output format requirements
    promptParts.push('');
    promptParts.push(
      ...getOutputFormatTemplate(includeAppearance, includePersonality, includeBackstory),
    );

    // D&D-specific guidelines
    promptParts.push('');
    promptParts.push(...CHARACTER_GUIDELINES_TEMPLATE);

    return promptParts.join('\n');
  }

  /**
   * Create a prompt for generating a quick character description
   */
  static buildQuickDescriptionPrompt(characterData: CharacterData): string {
    return getQuickDescriptionTemplate(characterData);
  }
}
