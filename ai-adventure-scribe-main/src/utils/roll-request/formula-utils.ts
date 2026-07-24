/**
 * Roll Request Formula Utilities
 * Extracted from regex-parser.ts
 */

/** Normalize dice formula to standard format */
export function normalizeFormula(formula: string): string {
  if (!formula) return '1d20';

  const compactFormula = formula.replace(/\s+/g, '').toLowerCase();
  if (/[+-]{2,}[a-z]/.test(compactFormula)) return '1d20';

  let normalized = compactFormula
    .replace(/(?<![+\-*/])modifier/g, '')
    .replace(/\+\+/g, '+')
    .replace(/--/g, '-')
    .replace(/\+$/, '')
    .replace(/-$/, '');

  if (normalized.startsWith('d')) {
    normalized = '1' + normalized;
  }

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

const ABILITY_NAMES = {
  str: 'strength',
  strength: 'strength',
  dex: 'dexterity',
  dexterity: 'dexterity',
  con: 'constitution',
  constitution: 'constitution',
  int: 'intelligence',
  intelligence: 'intelligence',
  wis: 'wisdom',
  wisdom: 'wisdom',
  cha: 'charisma',
  charisma: 'charisma',
} as const;

type AbilityKey = (typeof ABILITY_NAMES)[keyof typeof ABILITY_NAMES];

function abilityModifier(character: Record<string, unknown>, ability: AbilityKey): number | null {
  const statsRecord = Array.isArray(character.character_stats)
    ? character.character_stats[0]
    : character.character_stats;
  const sources = [character.abilityScores, character.ability_scores, statsRecord, character.stats];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const value = (source as Record<string, unknown>)[ability];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.floor((value - 10) / 2);
    }
    if (value && typeof value === 'object') {
      const modifier = (value as { modifier?: unknown }).modifier;
      if (typeof modifier === 'number' && Number.isFinite(modifier)) return modifier;
      const score = (value as { score?: unknown }).score;
      if (typeof score === 'number' && Number.isFinite(score)) return Math.floor((score - 10) / 2);
    }
  }
  return null;
}

/**
 * Resolve the app's normalized symbolic ability tokens against a loaded sheet.
 * Returns null rather than inventing a modifier when the formula remains symbolic.
 */
export function resolveFormulaForCharacter(
  formula: string,
  character: Record<string, unknown>,
  purpose = '',
  rollType = '',
): string | null {
  const unknownWords = formula
    .toLowerCase()
    .replace(/\d+d\d+/g, '')
    .replace(
      /\b(?:strength|dexterity|constitution|intelligence|wisdom|charisma|str|dex|con|int|wis|cha|mod|modifier)\b/g,
      '',
    )
    .match(/[a-z]+/g);
  if (unknownWords?.length) return null;
  let normalized = normalizeFormula(formula);
  const symbolic =
    /\b(strength|dexterity|constitution|intelligence|wisdom|charisma|str|dex|con|int|wis|cha|mod|modifier)\b/gi;
  normalized = normalized.replace(symbolic, (token) => {
    const lower = token.toLowerCase();
    let ability: AbilityKey | undefined = ABILITY_NAMES[lower as keyof typeof ABILITY_NAMES];
    if (!ability && (lower === 'mod' || lower === 'modifier')) {
      if (rollType === 'initiative') ability = 'dexterity';
      else {
        const purposeAbility = Object.entries(ABILITY_NAMES).find(([alias]) =>
          new RegExp(`\\b${alias}\\b`, 'i').test(purpose),
        );
        ability = purposeAbility?.[1];
      }
    }
    const modifier = ability ? abilityModifier(character, ability) : null;
    return modifier === null ? token : String(modifier);
  });
  if (/[a-z]/i.test(normalized.replace(/\d+d\d+/gi, ''))) return null;
  return /^\d+d\d+(?:[+-]\d+)*$/i.test(normalized) ? normalized : null;
}
