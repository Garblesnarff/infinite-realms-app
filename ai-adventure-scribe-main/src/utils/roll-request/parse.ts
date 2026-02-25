/* eslint-disable max-lines */
/**
 * Roll Request Parser (parse stage)
 * Parses DM messages to detect and extract dice roll requests
 */

import type { RollRequest } from '@/types/roll-request';

export interface ParsedRollRequest extends RollRequest {
  originalText: string;
  confidence: number; // 0-1, how confident we are this is a roll request
}

// ⚡ Bolt: Static regex and patterns moved outside the function to avoid re-compilation on every call.

/** Structured code block pattern */
const CODE_BLOCK_PATTERN = /```ROLL_REQUESTS_V1\s*\n([\s\S]*?)\n```/gi;

/** Common skill regex used across multiple patterns */
const SKILL_REGEX_STR =
  '(perception|stealth|investigation|insight|persuasion|deception|intimidation|athletics|acrobatics|arcana|history|medicine|nature|religion|survival|performance|sleight\\s+of\\s+hand|animal\\s+handling)';

/** Enhanced attack roll detection (without explicit dice) */
const ATTACK_PATTERNS = [
  /(?:please\s+)?(?:make\s+an?|roll\s+an?)\s*attack\s*(?:roll)?/gi,
  /roll\s+to\s+(?:attack|hit)/gi,
  /(?:make\s+an?|roll\s+(?:for\s+)?)\s*attack(?:\s+roll)?/gi,
];

/** Weapon hint pattern used around attack phrases */
const WEAPON_HINT_PATTERN =
  /\b(?:with|using|wielding|firing|shooting|from)\s+(?:your|my|the)?\s*([A-Za-z][\w' -]{2,40})/i;

/** AC pattern used around attack phrases */
const AC_TAIL_PATTERN = /(ac|armor\s*class)\s*[:=]?\s*(\d{1,2})/i;

/** Spell attack detection patterns */
const SPELL_ATTACK_PATTERNS = [
  /(?:i\s+)?cast\s+(?:a\s+)?([a-z\s]+?)(?:\s+at|\s+on|\s+to)/gi,
  /(?:i\s+)?cast\s+([a-z\s]+?)$/gi,
  /(?:use|fire|launch)\s+(?:my\s+)?([a-z\s]+?)(?:\s+spell|\s+cantrip)/gi,
  /(?:make|roll)\s+(?:a\s+)?(?:ranged\s+)?spell\s+attack/gi,
  /(?:melee\s+)?spell\s+attack\s+(?:roll|with)/gi,
];

/** Common spells that imply an attack roll */
const COMMON_ATTACK_SPELLS = [
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
const INITIATIVE_PATTERNS = [/roll\s+initiative.*?\(([^)]+)\)/gi, /roll\s+initiative/gi];

/** Skill/Ability checks and saves with explicit dice */
const CHECK_EXPLICIT_PATTERN =
  /make\s+an?\s+(constitution|dexterity|strength|intelligence|wisdom|charisma|[\w\s]+)\s+(check|save|saving\s+throw).*?\((?!\s*DC\s*\d+\s*\))([^)]+)(?:,\s*DC\s+(\d+))?\)/gi;

/** "Roll for <skill> (DC 14)" without explicit dice */
const ROLL_FOR_SKILL_PATTERN = new RegExp(
  `(?:please\\s+)?roll\\s+for\\s+${SKILL_REGEX_STR}(?:\\s*\\((?:dc|DC)\\s*(\\d+)\\))?`,
  'gi',
);

/** Skill checks without explicit dice (article-agnostic: a/an) */
const SKILL_CHECK_STRICT_PATTERN = new RegExp(`make\\s+an?\\s+${SKILL_REGEX_STR}\\s+check`, 'gi');

/** "Roll an <skill> check" (optional DC) */
const ROLL_SKILL_CHECK_PATTERN = new RegExp(
  `(?:please\\s+)?roll\\s+an?\\s+${SKILL_REGEX_STR}\\s+check(?:\\s*\\(?\\s*(?:dc|DC)\\s*(\\d+)\\s*\\)?)?`,
  'gi',
);

/** Polite/requested forms: "Give me an Investigation check (DC 15)" */
const REQUEST_SKILL_CHECK_PATTERN = new RegExp(
  `(?:please\\s+)?(?:i\\s+need\\s+|give\\s+me\\s+|perform\\s+)?an?\\s*${SKILL_REGEX_STR}\\s+check(?:\\s*\\(?\\s*(?:dc|DC)\\s*(\\d+)\\s*\\)?)?`,
  'gi',
);

/** Simple form without the word "check": "Roll Investigation (DC 12)" */
const ROLL_SKILL_SIMPLE_PATTERN = new RegExp(
  `(?:please\\s+)?roll\\s+${SKILL_REGEX_STR}(?:\\s*\\(?\\s*(?:dc|DC)\\s*(\\d+)\\s*\\)?)?`,
  'gi',
);

/** DC/AC parsing in context window */
const DC_CONTEXT_PATTERN = /(?:target\s*)?(?:dc|difficulty\s*class)\s*(\d+)/i;

/** Enhanced damage rolls */
const DAMAGE_PATTERNS = [
  /roll\s+damage.*?\(([^)]+)\)/gi,
  /roll\s+critical\s+damage.*?\(([^)]+)\)/gi,
  /roll\s+([\dd+\s-]+)\s+for\s+damage/gi,
  /now\s+roll\s+damage/gi,
  /roll\s+(?:your\s+)?(?:weapon\s+)?damage/gi,
  /(?:that\s+hits|you\s+hit).*?roll\s+damage/gi,
  /critical\s+hit.*?roll.*?damage/gi,
];

/** Generic roll requests with explicit dice */
const GENERIC_ROLL_PATTERN =
  /(?:please\s+)?roll\s+([\dd+\s-]+)(?:\s+for\s+(.+?))?(?:\s+\((?:[^)]*?\b(?:dc|DC)\s*(\d+)|[^)]*?\bAC\s*(\d+))\))?/gi;

/**
 * Parse a DM message for dice roll requests
 */
export function parseRollRequests(message: string): ParsedRollRequest[] {
  const requests: ParsedRollRequest[] = [];

  // PRIORITY 1: Extract structured ROLL_REQUESTS_V1 code blocks
  let codeBlockMatch: RegExpExecArray | null;
  CODE_BLOCK_PATTERN.lastIndex = 0; // Reset stateful regex

  while ((codeBlockMatch = CODE_BLOCK_PATTERN.exec(message)) !== null) {
    try {
      const jsonContent = codeBlockMatch[1].trim();
      const parsed = JSON.parse(jsonContent);

      if (parsed.rolls && Array.isArray(parsed.rolls)) {
        parsed.rolls.forEach((roll: Record<string, unknown>) => {
          if (roll.type && roll.formula && roll.purpose) {
            requests.push({
              type: roll.type as RollRequest['type'],
              formula: roll.formula,
              purpose: roll.purpose,
              dc: roll.dc,
              ac: roll.ac,
              advantage: roll.advantage,
              disadvantage: roll.disadvantage,
              // Additional fields for damage_taken type
              target: roll.target,
              damageType: roll.damageType,
              originalText: `ROLL_REQUESTS_V1: ${roll.purpose}`,
              confidence: 1.0, // Structured data is highest confidence
            });
          }
        });
      }
    } catch (error) {
      console.warn('Failed to parse ROLL_REQUESTS_V1 code block:', error);
    }
  }

  // If we found structured rolls, return them immediately (no need for regex fallbacks)
  if (requests.length > 0) {
    return requests;
  }

  // PRIORITY 2: Fall back to regex pattern matching
  let match: RegExpExecArray | null;

  // Normalize message to improve regex robustness (strip basic markdown, collapse spaces)
  const text = (message || '')
    .replace(/\*\*/g, '') // bold
    .replace(/\*/g, '') // italics
    .replace(/_/g, '') // underscore emphasis
    .replace(/`/g, '') // inline code
    .replace(/\s+/g, ' ')
    .trim();

  ATTACK_PATTERNS.forEach((pattern) => {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      // Look around the match to extract context (weapon, AC)
      const start = Math.max(0, match.index - 120);
      const end = Math.min(text.length, match.index + (match[0]?.length || 0) + 200);
      const windowText = text.slice(start, end);

      const weaponMatch = WEAPON_HINT_PATTERN.exec(windowText);
      const weaponName = weaponMatch ? weaponMatch[1].trim() : undefined;
      const acMatch = AC_TAIL_PATTERN.exec(windowText);
      const ac = acMatch ? parseInt(acMatch[2], 10) : undefined;

      requests.push({
        type: 'attack',
        formula: '1d20+modifier',
        purpose: weaponName ? `${weaponName} attack` : 'Attack roll',
        ac,
        originalText: match[0],
        confidence: 0.95,
      });
    }
  });

  // Spell attack detection
  SPELL_ATTACK_PATTERNS.forEach((pattern) => {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const spellName = match[1]?.trim().toLowerCase();
      let purpose = 'Spell attack';

      // Check if it's a known spell
      if (spellName && COMMON_ATTACK_SPELLS.some((spell) => spellName.includes(spell))) {
        const spell = COMMON_ATTACK_SPELLS.find((s) => spellName.includes(s));
        purpose = `${spell
          ?.split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')} attack`;
      } else if (spellName && spellName.length > 2) {
        purpose = `${spellName
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')} spell attack`;
      }

      // Look for AC in context
      const start = Math.max(0, match.index - 120);
      const end = Math.min(text.length, match.index + (match[0]?.length || 0) + 200);
      const windowText = text.slice(start, end);
      const acMatch = AC_TAIL_PATTERN.exec(windowText);
      const ac = acMatch ? parseInt(acMatch[2], 10) : undefined;

      requests.push({
        type: 'attack',
        formula: '1d20+spell_attack_bonus',
        purpose,
        ac,
        originalText: match[0],
        confidence: 0.93,
      });
    }
  });

  // Initiative (enhanced)
  INITIATIVE_PATTERNS.forEach((pattern) => {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const formula = match[1] ? normalizeFormula(match[1]) : '1d20+dex';
      requests.push({
        type: 'initiative',
        formula,
        purpose: 'Initiative roll for combat order',
        originalText: match[0],
        confidence: 0.95,
      });
    }
  });

  // Skill/Ability checks and saves with explicit dice
  CHECK_EXPLICIT_PATTERN.lastIndex = 0;
  while ((match = CHECK_EXPLICIT_PATTERN.exec(text)) !== null) {
    const ability = match[1].toLowerCase();
    const type = match[2].toLowerCase();
    const formula = match[3].trim();
    const dc = match[4] ? parseInt(match[4]) : undefined;

    const rollType = type.includes('save') ? 'save' : 'check';
    const purpose = `${ability.charAt(0).toUpperCase() + ability.slice(1)} ${type}`;

    requests.push({
      type: rollType as 'save' | 'check',
      formula: normalizeFormula(formula),
      purpose,
      dc,
      originalText: match[0],
      confidence: 0.9,
    });
  }

  // "Roll for <skill> (DC 14)" without explicit dice
  ROLL_FOR_SKILL_PATTERN.lastIndex = 0;
  while ((match = ROLL_FOR_SKILL_PATTERN.exec(text)) !== null) {
    const skill = match[1].toLowerCase();
    const dc = match[2] ? parseInt(match[2]) : undefined;
    requests.push({
      type: 'check',
      formula: '1d20+modifier',
      purpose: `${skill.charAt(0).toUpperCase() + skill.slice(1)} check`,
      dc,
      originalText: match[0],
      confidence: 0.92,
    });
  }

  // Skill checks without explicit dice (article-agnostic: a/an)
  SKILL_CHECK_STRICT_PATTERN.lastIndex = 0;
  while ((match = SKILL_CHECK_STRICT_PATTERN.exec(text)) !== null) {
    const skill = match[1].toLowerCase();
    // Try to capture nearby DC (e.g., "(target DC 14)") in the trailing window
    const tail = text.slice(match.index, Math.min(match.index + 200, text.length));
    const dcMatch = DC_CONTEXT_PATTERN.exec(tail);
    const dc = dcMatch ? parseInt(dcMatch[1], 10) : undefined;

    requests.push({
      type: 'skill_check',
      formula: '1d20+modifier',
      purpose: `${skill.charAt(0).toUpperCase() + skill.slice(1)} check`,
      dc,
      originalText: match[0],
      confidence: 0.9,
    });
  }

  // "Roll an <skill> check" (optional DC)
  ROLL_SKILL_CHECK_PATTERN.lastIndex = 0;
  while ((match = ROLL_SKILL_CHECK_PATTERN.exec(text)) !== null) {
    const skill = match[1].toLowerCase();
    // Prefer explicit capture; otherwise search nearby for DC phrasing
    let dc = match[2] ? parseInt(match[2], 10) : undefined;
    if (typeof dc === 'undefined') {
      const tail = text.slice(match.index, Math.min(match.index + 200, text.length));
      const dcMatch = DC_CONTEXT_PATTERN.exec(tail);
      if (dcMatch) dc = parseInt(dcMatch[1], 10);
    }
    requests.push({
      type: 'skill_check',
      formula: '1d20+modifier',
      purpose: `${skill.charAt(0).toUpperCase() + skill.slice(1)} check`,
      dc,
      originalText: match[0],
      confidence: 0.95,
    });
  }

  // Polite/requested forms: "Give me an Investigation check (DC 15)"
  REQUEST_SKILL_CHECK_PATTERN.lastIndex = 0;
  while ((match = REQUEST_SKILL_CHECK_PATTERN.exec(text)) !== null) {
    const skill = match[1].toLowerCase();
    let dc = match[2] ? parseInt(match[2], 10) : undefined;
    if (typeof dc === 'undefined') {
      const tail = text.slice(match.index, Math.min(match.index + 200, text.length));
      const dcMatch = DC_CONTEXT_PATTERN.exec(tail);
      if (dcMatch) dc = parseInt(dcMatch[1], 10);
    }
    requests.push({
      type: 'skill_check',
      formula: '1d20+modifier',
      purpose: `${skill.charAt(0).toUpperCase() + skill.slice(1)} check`,
      dc,
      originalText: match[0],
      confidence: 0.93,
    });
  }

  // Simple form without the word "check": "Roll Investigation (DC 12)"
  ROLL_SKILL_SIMPLE_PATTERN.lastIndex = 0;
  while ((match = ROLL_SKILL_SIMPLE_PATTERN.exec(text)) !== null) {
    const skill = match[1].toLowerCase();
    let dc = match[2] ? parseInt(match[2], 10) : undefined;
    if (typeof dc === 'undefined') {
      const tail = text.slice(match.index, Math.min(match.index + 200, text.length));
      const dcMatch = DC_CONTEXT_PATTERN.exec(tail);
      if (dcMatch) dc = parseInt(dcMatch[1], 10);
    }
    requests.push({
      type: 'skill_check',
      formula: '1d20+modifier',
      purpose: `${skill.charAt(0).toUpperCase() + skill.slice(1)} check`,
      dc,
      originalText: match[0],
      confidence: 0.92,
    });
  }

  // Enhanced damage rolls
  DAMAGE_PATTERNS.forEach((pattern, index) => {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(message)) !== null) {
      let formula = '1d6';
      let confidence = 0.85;
      let purpose = 'Damage roll';

      if (match[1]) formula = normalizeFormula(match[1]);
      if (index < 2) confidence = 0.95;
      if (match[0].toLowerCase().includes('critical')) {
        purpose = 'Critical damage roll';
        confidence = 0.98;
      }

      requests.push({ type: 'damage', formula, purpose, originalText: match[0], confidence });
    }
  });

  // Generic roll requests with explicit dice
  GENERIC_ROLL_PATTERN.lastIndex = 0;
  while ((match = GENERIC_ROLL_PATTERN.exec(text)) !== null) {
    if (requests.some((r) => r.originalText.includes(match[0]))) continue;

    const formula = match[1].trim();
    const purpose = match[2] || 'Dice roll';
    const dc = match[3] ? parseInt(match[3]) : undefined;
    const ac = match[4] ? parseInt(match[4]) : undefined;

    let type: RollRequest['type'] = 'check';
    if (purpose.toLowerCase().includes('attack')) type = 'attack';
    else if (purpose.toLowerCase().includes('damage')) type = 'damage';
    else if (purpose.toLowerCase().includes('save')) type = 'save';
    else if (purpose.toLowerCase().includes('initiative')) type = 'initiative';

    requests.push({
      type,
      formula: normalizeFormula(formula),
      purpose: purpose.charAt(0).toUpperCase() + purpose.slice(1),
      dc,
      ac,
      originalText: match[0],
      confidence: 0.7,
    });
  }

  const seenPurposes = new Set<string>();
  const uniqueRequests = requests
    .filter((r) => r.confidence > 0.5)
    .sort((a, b) => b.confidence - a.confidence)
    .filter((request) => {
      if (seenPurposes.has(request.purpose)) return false;
      seenPurposes.add(request.purpose);
      return true;
    });

  return uniqueRequests;
}

/** Normalize dice formula to standard format */
export function normalizeFormula(formula: string): string {
  let normalized = formula
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/modifier/g, '')
    .replace(/\+\+/g, '+')
    .replace(/--/g, '-')
    .replace(/\+$/, '')
    .replace(/-$/, '');

  if (!/^\d*d\d+/.test(normalized)) {
    if (/^[+-]?\d+$/.test(normalized)) {
      normalized =
        '1d20' + (normalized.startsWith('+') || normalized.startsWith('-') ? '' : '+') + normalized;
    } else if (
      normalized.includes('dex') ||
      normalized.includes('str') ||
      normalized.includes('con') ||
      normalized.includes('int') ||
      normalized.includes('wis') ||
      normalized.includes('cha')
    ) {
      normalized = '1d20+modifier';
    } else {
      normalized = '1d20';
    }
  }

  // Preserve symbolic ability formulas like "1d20+cha", "1d20+wis" — validated by component
  if (/^\d*d\d+[+-][a-z]+$/.test(normalized)) {
    return normalized;
  }

  if (!normalized.match(/^\d*d\d+([+-]\d+)*$/)) {
    return '1d20';
  }

  return normalized;
}
