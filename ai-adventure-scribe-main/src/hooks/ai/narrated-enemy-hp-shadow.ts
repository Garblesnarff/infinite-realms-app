import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

const HP = String.raw`(?:hp|hit\s+points?)`;
const HP_NUMBER = String.raw`\d+\s*${HP}\b`;
const PATTERNS = [
  ['hp_left', new RegExp(String.raw`\b${HP_NUMBER}\s+left\b`, 'i')],
  ['hp_remaining', new RegExp(String.raw`\b${HP_NUMBER}\s+remaining\b`, 'i')],
  ['down_to_hp', new RegExp(String.raw`\bdown\s+to\s+${HP_NUMBER}`, 'i')],
  [
    'hp_fraction',
    new RegExp(String.raw`\b(?:\d+\s*/\s*${HP_NUMBER}|${HP}\s+\d+\s*/\s*\d+\b)`, 'i'),
  ],
] as const;

const HERO_WORDING =
  /\byou\s+(?:have|had|are|were|drop(?:ped)?|fall|fell)\b|\byou['’]re\b|\byour\s+(?:hp|hit\s+points?)\b/i;

export function narratedEnemyHpPatterns(text: string, heroName?: string): string[] {
  const name = heroName?.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hero = name ? new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'iu') : null;
  const patterns = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (HERO_WORDING.test(sentence) || hero?.test(sentence)) continue;
    for (const [pattern, match] of PATTERNS) {
      if (match.test(sentence)) patterns.add(pattern);
    }
  }
  return [...patterns].sort();
}

export function shadowNarratedEnemyHp(
  text: string,
  sessionId: string | undefined,
  heroName?: string,
): void {
  try {
    const patterns = narratedEnemyHpPatterns(text, heroName);
    if (patterns.length) reportNarrationShadowHit('narrated_enemy_hp_number', sessionId, patterns);
  } catch {
    // The telemetry must never interrupt narration.
  }
}
