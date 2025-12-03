import { CharacterContext, PassiveScores } from './types.ts';

/**
 * PassiveSkillsEvaluator
 * Deno-compatible passive skill calculations for AI DM integration.
 * Implements D&D 5E passive skill rules (PHB p.175)
 *
 * Formula: Passive Skill = 10 + ability modifier + proficiency bonus (if proficient)
 */

/**
 * D&D 5E Proficiency Bonus by Level
 * Inline table for Deno compatibility (no external imports)
 */
const PROFICIENCY_BONUS_TABLE: Record<number, number> = {
  1: 2, 2: 2, 3: 2, 4: 2,
  5: 3, 6: 3, 7: 3, 8: 3,
  9: 4, 10: 4, 11: 4, 12: 4,
  13: 5, 14: 5, 15: 5, 16: 5,
  17: 6, 18: 6, 19: 6, 20: 6,
};

/**
 * Get proficiency bonus for a given character level
 * @param level - Character level (1-20)
 * @returns Proficiency bonus (+2 to +6)
 */
function getProficiencyBonus(level: number): number {
  return PROFICIENCY_BONUS_TABLE[Math.min(20, Math.max(1, level))] || 2;
}

/**
 * Calculate ability modifier from ability score
 * Formula: (score - 10) / 2, rounded down
 * @param score - Ability score (typically 3-20, can be higher)
 * @returns Ability modifier (-4 to +5 for typical scores)
 */
function calculateAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Check if character has the Observant feat
 * Observant grants +5 to Passive Perception and Passive Investigation (PHB p.168)
 * @param character - Character context
 * @returns True if character has Observant feat
 */
function hasObservantFeat(character: CharacterContext): boolean {
  return character.feats?.some(
    (f) => f.id === 'observant' || f.name?.toLowerCase() === 'observant'
  ) || false;
}

/**
 * Calculate a passive skill score
 * @param abilityScore - The relevant ability score (e.g., Wisdom for Perception)
 * @param proficiencyBonus - Character's proficiency bonus based on level
 * @param isProficient - Whether the character is proficient in this skill
 * @param observantBonus - +5 if Observant feat applies to this skill
 * @returns Passive skill score (10 + modifier + proficiency)
 */
function calculatePassiveSkill(
  abilityScore: number,
  proficiencyBonus: number,
  isProficient: boolean,
  observantBonus: number = 0,
): number {
  const abilityModifier = calculateAbilityModifier(abilityScore);
  const proficiency = isProficient ? proficiencyBonus : 0;
  return 10 + abilityModifier + proficiency + observantBonus;
}

/**
 * Calculate passive Perception (Wisdom-based)
 * Used for: Noticing hidden creatures, traps, secret doors
 * @param character - Character context
 * @returns Passive Perception score
 */
function calculatePassivePerception(character: CharacterContext): number {
  // Graceful defaults if character data is incomplete
  if (!character.abilityScores || !character.level) {
    console.warn('[PassiveSkills] Incomplete character data for passive Perception, defaulting to 10');
    return 10;
  }

  const wisdomScore = character.abilityScores.wisdom.score;
  const proficiencyBonus = getProficiencyBonus(character.level);
  const isProficient = character.skillProficiencies?.includes('Perception') || false;
  const observantBonus = hasObservantFeat(character) ? 5 : 0;

  return calculatePassiveSkill(wisdomScore, proficiencyBonus, isProficient, observantBonus);
}

/**
 * Calculate passive Insight (Wisdom-based)
 * Used for: Detecting lies, sensing motives, reading body language
 * @param character - Character context
 * @returns Passive Insight score
 */
function calculatePassiveInsight(character: CharacterContext): number {
  // Graceful defaults if character data is incomplete
  if (!character.abilityScores || !character.level) {
    console.warn('[PassiveSkills] Incomplete character data for passive Insight, defaulting to 10');
    return 10;
  }

  const wisdomScore = character.abilityScores.wisdom.score;
  const proficiencyBonus = getProficiencyBonus(character.level);
  const isProficient = character.skillProficiencies?.includes('Insight') || false;

  return calculatePassiveSkill(wisdomScore, proficiencyBonus, isProficient);
}

/**
 * Calculate passive Investigation (Intelligence-based)
 * Used for: Seeing through illusions, noticing clues at a glance
 * @param character - Character context
 * @returns Passive Investigation score
 */
function calculatePassiveInvestigation(character: CharacterContext): number {
  // Graceful defaults if character data is incomplete
  if (!character.abilityScores || !character.level) {
    console.warn('[PassiveSkills] Incomplete character data for passive Investigation, defaulting to 10');
    return 10;
  }

  const intelligenceScore = character.abilityScores.intelligence.score;
  const proficiencyBonus = getProficiencyBonus(character.level);
  const isProficient = character.skillProficiencies?.includes('Investigation') || false;
  const observantBonus = hasObservantFeat(character) ? 5 : 0;

  return calculatePassiveSkill(intelligenceScore, proficiencyBonus, isProficient, observantBonus);
}

/**
 * Calculate all passive scores for a character
 * Main function used by DM agent to get passive scores for prompt injection
 * @param character - Character context
 * @returns PassiveScores object with all three passive skills
 */
export function calculatePassiveScores(character: CharacterContext): PassiveScores {
  const perception = calculatePassivePerception(character);
  const insight = calculatePassiveInsight(character);
  const investigation = calculatePassiveInvestigation(character);

  console.log('[PassiveSkills] Calculated scores for', character.name, {
    perception,
    insight,
    investigation,
    hasObservant: hasObservantFeat(character),
  });

  return {
    perception,
    insight,
    investigation,
  };
}

/**
 * Format passive scores for prompt injection
 * Creates a human-readable string for AI context
 * @param scores - PassiveScores object
 * @returns Formatted string for prompts
 */
export function formatPassiveScoresForPrompt(scores: PassiveScores): string {
  return `Passive Perception: ${scores.perception}, Passive Insight: ${scores.insight}, Passive Investigation: ${scores.investigation}`;
}
