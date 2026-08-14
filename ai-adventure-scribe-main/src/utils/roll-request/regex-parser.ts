/**
 * Roll Request Regex Parser
 * Natural language processing to detect and extract dice roll requests from DM messages
 */

import { normalizeFormula } from './formula-utils';
import { parseBoundedTargetNumber } from './number-bounds';
import {
  AC_TAIL_PATTERN,
  ATTACK_PATTERNS,
  CHECK_EXPLICIT_PATTERN,
  COMMON_ATTACK_SPELLS,
  DAMAGE_PATTERNS,
  DC_CONTEXT_PATTERN,
  GENERIC_ROLL_PATTERN,
  INITIATIVE_PATTERNS,
  REQUEST_SKILL_CHECK_PATTERN,
  ROLL_FOR_SKILL_PATTERN,
  ROLL_SKILL_CHECK_PATTERN,
  ROLL_SKILL_SIMPLE_PATTERN,
  SKILL_CHECK_STRICT_PATTERN,
  SPELL_ATTACK_PATTERNS,
  WEAPON_HINT_PATTERN,
} from './regex-patterns';

import type { ParsedRollRequest } from './regex-patterns';

// Re-export for backward compatibility
export type { ParsedRollRequest };

/**
 * Main regex-based parsing orchestrator
 */
export function parseRegexRollRequests(message: string): ParsedRollRequest[] {
  const requests: ParsedRollRequest[] = [];
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

      WEAPON_HINT_PATTERN.lastIndex = 0;
      const weaponMatch = WEAPON_HINT_PATTERN.exec(windowText);
      const rawWeaponName = weaponMatch ? weaponMatch[1].trim() : undefined;
      const weaponName = rawWeaponName
        ? rawWeaponName.charAt(0).toUpperCase() + rawWeaponName.slice(1)
        : undefined;
      const acMatch = AC_TAIL_PATTERN.exec(windowText);
      const ac = acMatch ? parseBoundedTargetNumber(acMatch[2]) : undefined;

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
      const ac = acMatch ? parseBoundedTargetNumber(acMatch[2]) : undefined;

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
    const dc = match[4] ? parseBoundedTargetNumber(match[4]) : undefined;

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
    const dc = match[2] ? parseBoundedTargetNumber(match[2]) : undefined;
    requests.push({
      type: 'check',
      formula: '1d20+modifier',
      purpose: `${skill
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')} check`,
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
    const tail = text.slice(match.index);
    const dcMatch = DC_CONTEXT_PATTERN.exec(tail);
    const dc = dcMatch ? parseBoundedTargetNumber(dcMatch[1]) : undefined;

    requests.push({
      type: 'skill_check',
      formula: '1d20+modifier',
      purpose: `${skill
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')} check`,
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
    let dc = match[2] ? parseBoundedTargetNumber(match[2]) : undefined;
    if (typeof dc === 'undefined') {
      const tail = text.slice(match.index, Math.min(match.index + 200, text.length));
      const dcMatch = DC_CONTEXT_PATTERN.exec(tail);
      if (dcMatch) dc = parseBoundedTargetNumber(dcMatch[1]);
    }
    requests.push({
      type: 'skill_check',
      formula: '1d20+modifier',
      purpose: `${skill
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')} check`,
      dc,
      originalText: match[0],
      confidence: 0.95,
    });
  }

  // Polite/requested forms: "Give me an Investigation check (DC 15)"
  REQUEST_SKILL_CHECK_PATTERN.lastIndex = 0;
  while ((match = REQUEST_SKILL_CHECK_PATTERN.exec(text)) !== null) {
    const skill = match[1].toLowerCase();
    let dc = match[2] ? parseBoundedTargetNumber(match[2]) : undefined;
    if (typeof dc === 'undefined') {
      const tail = text.slice(match.index, Math.min(match.index + 200, text.length));
      const dcMatch = DC_CONTEXT_PATTERN.exec(tail);
      if (dcMatch) dc = parseBoundedTargetNumber(dcMatch[1]);
    }
    requests.push({
      type: 'skill_check',
      formula: '1d20+modifier',
      purpose: `${skill
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')} check`,
      dc,
      originalText: match[0],
      confidence: 0.93,
    });
  }

  // Simple form without the word "check": "Roll Investigation (DC 12)"
  ROLL_SKILL_SIMPLE_PATTERN.lastIndex = 0;
  while ((match = ROLL_SKILL_SIMPLE_PATTERN.exec(text)) !== null) {
    const skill = match[1].toLowerCase();
    let dc = match[2] ? parseBoundedTargetNumber(match[2]) : undefined;
    if (typeof dc === 'undefined') {
      const tail = text.slice(match.index, Math.min(match.index + 200, text.length));
      const dcMatch = DC_CONTEXT_PATTERN.exec(tail);
      if (dcMatch) dc = parseBoundedTargetNumber(dcMatch[1]);
    }
    requests.push({
      type: 'skill_check',
      formula: '1d20+modifier',
      purpose: `${skill
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')} check`,
      dc,
      originalText: match[0],
      confidence: 0.92,
    });
  }

  // Enhanced damage rolls
  DAMAGE_PATTERNS.forEach((pattern, index) => {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
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
    const rawPurpose = match[2]?.trim();
    const purpose = rawPurpose
      ? rawPurpose.charAt(0).toUpperCase() + rawPurpose.slice(1)
      : 'Dice roll';

    // Parse AC/DC from parentheses content
    let dc: number | undefined;
    let ac: number | undefined;
    if (match[3]) {
      const dcMatch = /(?:dc|difficulty\s*class)\s*(\d+)/i.exec(match[3]);
      if (dcMatch) dc = parseBoundedTargetNumber(dcMatch[1]);
      const acMatch = /(?:ac|armor\s*class)\s*(\d+)/i.exec(match[3]);
      if (acMatch) ac = parseBoundedTargetNumber(acMatch[1]);
    }

    let type: ParsedRollRequest['type'] = 'check';
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

export { normalizeFormula };
