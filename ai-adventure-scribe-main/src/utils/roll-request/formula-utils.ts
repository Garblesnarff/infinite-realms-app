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
