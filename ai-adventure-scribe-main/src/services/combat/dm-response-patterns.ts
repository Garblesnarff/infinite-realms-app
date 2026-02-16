/**
 * DM Response Pattern Detection
 *
 * Pure regex-based functions for detecting combat-related patterns
 * in DM narrative text. Extracted from CombatSequenceValidator for
 * better testability and separation of concerns.
 *
 * All functions are pure: string in, boolean out, no side effects.
 */

/**
 * Detect if the response contains direct damage rolls/requests
 * (e.g., "roll 2d6+3 damage", "roll damage", "1d8 damage")
 */
export function detectsDirectDamage(response: string): boolean {
  const damagePatterns = [
    /roll\s+\d*d\d+(?:\+\d+)?\s+(?:for\s+)?damage/gi,
    /roll\s+damage/gi,
    /\d*d\d+(?:\+\d+)?\s+damage/gi,
  ];
  return damagePatterns.some((pattern) => pattern.test(response));
}

/**
 * Detect if the response indicates combat is starting
 * (e.g., "combat begins", "initiative", "roll for initiative", "battle starts")
 */
export function detectsCombatStart(response: string): boolean {
  const combatPatterns = [
    /combat\s+begins/gi,
    /initiative/gi,
    /roll\s+for\s+initiative/gi,
    /battle\s+starts/gi,
  ];
  return combatPatterns.some((pattern) => pattern.test(response));
}

/**
 * Detect if the response requests an attack roll
 * (e.g., "make an attack roll", "roll to attack", "attack roll")
 */
export function detectsAttackRequest(response: string): boolean {
  const attackPatterns = [
    /make\s+an?\s+attack\s+roll/gi,
    /roll\s+(?:to\s+)?attack/gi,
    /attack\s+roll/gi,
  ];
  return attackPatterns.some((pattern) => pattern.test(response));
}

/**
 * Detect if the response requests a skill check
 * (e.g., "make a Perception check", "roll a Stealth check", "Athletics check")
 */
export function detectsSkillCheck(response: string): boolean {
  const skillPatterns = [/make\s+a\s+\w+\s+check/gi, /roll\s+a\s+\w+\s+check/gi, /\w+\s+check/gi];
  return skillPatterns.some((pattern) => pattern.test(response));
}

/**
 * Detect if the response requests a damage roll
 * (e.g., "roll damage", "roll 2d6 for damage")
 */
export function detectsDamageRequest(response: string): boolean {
  return /roll.*damage/gi.test(response);
}

/**
 * Check if the response contains an Armor Class reference
 * (e.g., "AC 15", "armor class 18")
 */
export function containsAC(response: string): boolean {
  return /AC\s+\d+/gi.test(response) || /armor\s+class\s+\d+/gi.test(response);
}

/**
 * Check if the response contains a Difficulty Class reference
 * (e.g., "DC 12", "difficulty class 15")
 */
export function containsDC(response: string): boolean {
  return /DC\s+\d+/gi.test(response) || /difficulty\s+class\s+\d+/gi.test(response);
}

/**
 * Check if the response contains an ability/damage modifier
 * (e.g., "+STR", "+3", "+dex")
 */
export function containsModifier(response: string): boolean {
  return /\+\s*(?:str|dex|con|int|wis|cha|\d+)/gi.test(response);
}
