import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

export const ABILITY_SCORE_NAMES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

export type AbilityScoreName = (typeof ABILITY_SCORE_NAMES)[number];
export type NormalizedAbilityScores = Record<AbilityScoreName, number>;

const ABILITY_SCORE_KEY_ALIASES: Record<string, AbilityScoreName> = {
  strength: 'strength',
  str: 'strength',
  dexterity: 'dexterity',
  dex: 'dexterity',
  constitution: 'constitution',
  con: 'constitution',
  intelligence: 'intelligence',
  int: 'intelligence',
  wisdom: 'wisdom',
  wis: 'wisdom',
  charisma: 'charisma',
  cha: 'charisma',
};

export function normalizeAbilityScores(
  rawAbilityScores: unknown,
  context: { templateName?: string | null; templateClass?: string | null } = {},
): NormalizedAbilityScores {
  const raw =
    rawAbilityScores && typeof rawAbilityScores === 'object'
      ? (rawAbilityScores as Record<string, unknown>)
      : {};
  const normalized: Partial<NormalizedAbilityScores> = {};

  for (const [rawKey, value] of Object.entries(raw)) {
    const normalizedKey = ABILITY_SCORE_KEY_ALIASES[rawKey.trim().toLowerCase()];
    if (!normalizedKey) {
      return reportAndThrow(
        `Unrecognized ability score key "${rawKey}" in starter template "${context.templateName ?? 'unknown'}".`,
        raw,
        context,
        rawKey,
      );
    }
    normalized[normalizedKey] = value as number;
  }

  const missing = ABILITY_SCORE_NAMES.find((name) => normalized[name] === undefined);
  if (missing) {
    return reportAndThrow(
      `Missing ability score key "${missing}" in starter template "${context.templateName ?? 'unknown'}".`,
      raw,
      context,
      missing,
    );
  }

  return normalized as NormalizedAbilityScores;
}

function reportAndThrow(
  message: string,
  raw: Record<string, unknown>,
  context: { templateName?: string | null; templateClass?: string | null },
  key: string,
): never {
  logger.error('[AbilityScoreNormalization] Invalid starter ability scores', {
    templateName: context.templateName,
    templateClass: context.templateClass,
    key,
    keys: Object.keys(raw),
  });
  userDataApi.reportClientFailure(
    'invalid_ability_score_key',
    undefined,
    `${message} keys=${Object.keys(raw).join(',')}`,
  );
  throw new Error(message);
}
