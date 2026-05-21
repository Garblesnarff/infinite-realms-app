/**
 * Roll Request Regex Patterns
 * Extracted from regex-parser.ts
 */

import type { RollRequest } from '@/types/roll-request';

export interface ParsedRollRequest extends RollRequest {
  originalText: string;
  confidence: number; // 0-1, how confident we are this is a roll request
}

/** Common skill regex used across multiple patterns */
export const SKILL_REGEX_STR =
  '(perception|stealth|investigation|insight|persuasion|deception|intimidation|athletics|acrobatics|arcana|history|medicine|nature|religion|survival|performance|sleight\\s+of\\s+hand|animal\\s+handling)';

/** Enhanced attack roll detection (without explicit dice) */
export const ATTACK_PATTERNS = [
  /(?:please\s+)?(?:make\s+an?|roll\s+an?)\s*attack\s*(?:roll)?/gi,
  /roll\s+to\s+(?:attack|hit)/gi,
  /(?:make\s+an?|roll\s+(?:for\s+)?)\s*attack(?:\s+roll)?/gi,
];

/** Weapon hint pattern used around attack phrases */
export const WEAPON_HINT_PATTERN =
  /\b(?:with|using|wielding|firing|shooting|from)\s+(?:your|my|the)?\s*([A-Za-z][\w' -]{2,40})/gi;

/** AC pattern used around attack phrases */
export const AC_TAIL_PATTERN = /(ac|armor\s*class)\s*(?:is|[:=])?\s*(\d{1,2})/i;

/** Spell attack detection patterns */
export const SPELL_ATTACK_PATTERNS = [
  /(?:i\s+)?cast\s+(?:a\s+)?([a-z\s]+?)(?:\s+at|\s+on|\s+to)/gi,
  /(?:i\s+)?cast\s+([a-z\s]+?)$/gi,
  /(?:use|fire|launch)\s+(?:my\s+)?([a-z\s]+?)(?:\s+spell|\s+cantrip)/gi,
  /(?:make|roll)\s+(?:a\s+)?(?:ranged\s+)?spell\s+attack/gi,
  /(?:melee\s+)?spell\s+attack\s+(?:roll|with)/gi,
];

/** Common spells that imply an attack roll */
export const COMMON_ATTACK_SPELLS = [
  'fire bolt',
  'ray of frost',
  'eldritch blast',
  'sacred flame',
  'chill touch',
  'firebolt',
  'magic missile',
  'shocking grasp',
  'witch bolt',
  'chromatic orb',
  'guiding bolt',
  'inflict wounds',
  'spiritual weapon',
  'scorching ray',
];

/** Initiative patterns */
export const INITIATIVE_PATTERNS = [/roll\s+initiative.*?\(([^)]+)\)/gi, /roll\s+initiative/gi];

/** Skill/Ability checks and saves with explicit dice */
export const CHECK_EXPLICIT_PATTERN =
  /make\s+an?\s+(constitution|dexterity|strength|intelligence|wisdom|charisma|[\w\s]+)\s+(check|save|saving\s+throw).*?\((?!\s*DC\s*\d+\s*\))([^,)]+)(?:,\s*DC\s+(\d+))?\)/gi;

/** "Roll for <skill> (DC 14)" without explicit dice */
export const ROLL_FOR_SKILL_PATTERN = new RegExp(
  `(?:please\\s+)?roll\\s+for\\s+${SKILL_REGEX_STR}(?:\\s*\\((?:dc|DC)\\s*(\\d+)\\))?`,
  'gi',
);

/** Skill checks without explicit dice (article-agnostic: a/an) */
export const SKILL_CHECK_STRICT_PATTERN = new RegExp(`make\\s+an?\\s+${SKILL_REGEX_STR}\\s+check`, 'gi');

/** "Roll an <skill> check" (optional DC) */
export const ROLL_SKILL_CHECK_PATTERN = new RegExp(
  `(?:please\\s+)?roll\\s+an?\\s+${SKILL_REGEX_STR}\\s+check(?:\\s*\\(?\\s*(?:dc|DC)\\s*(\\d+)\\s*\\)?)?`,
  'gi',
);

/** Polite/requested forms: "Give me an Investigation check (DC 15)" */
export const REQUEST_SKILL_CHECK_PATTERN = new RegExp(
  `(?:please\\s+)?(?:i\\s+need\\s+|give\\s+me\\s+|perform\\s+)?an?\\s*${SKILL_REGEX_STR}\\s+check(?:\\s*\\(?\\s*(?:dc|DC)\\s*(\\d+)\\s*\\)?)?`,
  'gi',
);

/** Simple form without the word "check": "Roll Investigation (DC 12)" */
export const ROLL_SKILL_SIMPLE_PATTERN = new RegExp(
  `(?:please\\s+)?roll\\s+${SKILL_REGEX_STR}(?:\\s*\\(?\\s*(?:dc|DC)\\s*(\\d+)\\s*\\)?)?`,
  'gi',
);

/** DC/AC parsing in context window */
export const DC_CONTEXT_PATTERN = /(?:target\s*)?(?:dc|difficulty\s*class)\s*(\d+)/i;

/** Enhanced damage rolls */
export const DAMAGE_PATTERNS = [
  /roll\s+damage.*?\(([^)]+)\)/gi,
  /roll\s+critical\s+damage.*?\(([^)]+)\)/gi,
  /roll\s+([\dd+\s-]+)\s+for\s+damage/gi,
  /now\s+roll\s+damage/gi,
  /roll\s+(?:your\s+)?(?:weapon\s+)?damage/gi,
  /(?:that\s+hits|you\s+hit).*?roll\s+damage/gi,
  /critical\s+hit.*?roll.*?damage/gi,
];

/** Generic roll requests with explicit dice */
export const GENERIC_ROLL_PATTERN =
  /(?:please\s+)?roll\s+([\dd+\s-]+)(?:\s+for\s+([^(\n.]+?))?(?:\s+\(([^)]+)\))?(?:\s|$|\.)/gi;
