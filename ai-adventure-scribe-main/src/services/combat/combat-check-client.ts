/**
 * The client half of the mid-combat check (#2420): recognise the player's sentence, ask for their
 * die in the ordinary roll dialog, and post the typed intent the engine resolves.
 *
 * Three steps in one place because splitting them is how the same check gets resolved twice: the
 * detector decides, the popup supplies the player's die, and the POST claims the action. A
 * dismissed popup withdraws the check rather than posting a check with an engine-rolled die the
 * player never asked for.
 */

import {
  CombatIntentRefusedError,
  executeAuthoritativeCombatIntent,
} from './combat-action-executor';
import { requestPlayerCheckRoll } from './player-roll-bridge';
import { standingHostiles } from './sheet-cast-save-hold';
import { detectCombatCheck } from '../../../shared/combat-check-intent';
import { combatCheckModifierFor } from '../../../shared/combat-check-modifier';

import type { ClientCombatIntent } from './combat-action-executor';
import type { CombatCheckIntentKind } from '../../../shared/combat-check-intent';

import logger from '@/lib/logger';

/** The popup label for each check, and the ability whose modifier the sheet adds. */
const CHECK_LABELS: Record<CombatCheckIntentKind, string> = {
  shove: 'Shove',
  grapple: 'Grapple',
  escape: 'Escape',
  hide: 'Hide',
  parley: 'Persuasion',
};

/** The ability score each check reads, matching `CHECK_DEFINITIONS` in combat-check-rules. */
/**
 * The modifier the popup shows for a check: d20 plus this ability's modifier.
 *
 * Display only — the engine recomputes the check from the persisted sheet when it resolves, so a
 * stale number in this popup can never change an outcome. It exists so the die is not a bare
 * number, exactly as the attack popup shows its bonus.
 */
const ABILITY_NAMES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

function hasAbilityScores(
  scores: Record<string, unknown> | undefined,
): scores is Record<string, unknown> {
  return !!scores && Object.keys(scores).length > 0;
}

function scoresFromStatRow(
  row: Record<string, unknown> | undefined,
): Record<string, number> | undefined {
  if (!row) return undefined;
  const scores: Record<string, number> = {};
  for (const name of ABILITY_NAMES) {
    const value = row[name];
    if (typeof value === 'number' && Number.isFinite(value)) scores[name] = value;
  }
  return Object.keys(scores).length > 0 ? scores : undefined;
}

/** The blank character context has scores of 10 and no id. It is not a sheet. */
function isIdentifiedSheet(
  source: Record<string, unknown> | null | undefined,
): source is Record<string, unknown> {
  return typeof source?.id === 'string' && source.id.length > 0;
}

function skillsFrom(source: Record<string, unknown> | null | undefined): string[] | undefined {
  if (!isIdentifiedSheet(source)) return undefined;
  if (Array.isArray(source?.skillProficiencies)) return source.skillProficiencies.map(String);
  const raw = source.skill_proficiencies;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return undefined;
}

function levelFrom(source: Record<string, unknown> | null | undefined): number | undefined {
  if (!isIdentifiedSheet(source)) return undefined;
  return typeof source?.level === 'number' ? source.level : undefined;
}

function scoresFrom(
  source: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!isIdentifiedSheet(source)) return undefined;
  const named = source.abilityScores;
  if (hasAbilityScores(named as Record<string, unknown> | undefined)) {
    return named as Record<string, unknown>;
  }
  const rows = source.character_stats;
  const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
  return scoresFromStatRow(row);
}

/**
 * The profile a combat check prompt is allowed to display (#1017).
 *
 * The encounter participant does not carry ability scores, so a prompt built from
 * it alone is 1d20+0 while the engine rolls the sheet. The loaded sheet wins,
 * then the session character (`character_stats`, level, skill list), then whatever
 * the participant itself has.
 */
export function combatCheckProfile(
  participant:
    | {
        abilityScores?: Record<string, unknown>;
        skillProficiencies?: string[];
        level?: number;
      }
    | null
    | undefined,
  ...sources: Array<Record<string, unknown> | null | undefined>
): {
  abilityScores?: Record<string, unknown>;
  skillProficiencies?: string[];
  level?: number;
} {
  const abilityScores =
    sources.map(scoresFrom).find(hasAbilityScores) ??
    (hasAbilityScores(participant?.abilityScores) ? participant?.abilityScores : undefined);
  const skillProficiencies =
    sources.map(skillsFrom).find((skills) => skills !== undefined) ??
    participant?.skillProficiencies;
  const level = sources.map(levelFrom).find((level) => level !== undefined) ?? participant?.level;
  return { abilityScores, skillProficiencies, level };
}

export function skillCheckModifierFor(
  participant:
    | { abilityScores?: Record<string, unknown>; skillProficiencies?: string[]; level?: number }
    | null
    | undefined,
  kind: CombatCheckIntentKind,
  parleySkill?: 'persuade' | 'intimidate',
): number {
  const scoreOf = (short: string, long: string): number => {
    const raw = participant?.abilityScores?.[short] ?? participant?.abilityScores?.[long];
    if (typeof raw === 'number') return raw;
    const value = raw as { score?: number; modifier?: number } | undefined;
    if (typeof value?.score === 'number') return value.score;
    if (typeof value?.modifier === 'number') return value.modifier * 2 + 10;
    return 10;
  };
  const scores = {
    str: scoreOf('str', 'strength'),
    dex: scoreOf('dex', 'dexterity'),
    cha: scoreOf('cha', 'charisma'),
  };
  return combatCheckModifierFor(
    { scores, level: participant?.level ?? 1, skillProficiencies: participant?.skillProficiencies },
    kind === 'parley' ? (parleySkill ?? 'persuade') : kind,
  );
}

/** What the caller needs to resolve a check against real numbers. */
export interface CombatCheckClientContext {
  encounterId: string;
  actorId: string;
  /** The actor's name, for the popup's wording. */
  actorLabel: string;
  /**
   * The whole roster. The player is in it and is not a target: a "it" in the sentence names the
   * one hostile only when the player is left out of the count (`standingHostiles`).
   */
  participants: ReadonlyArray<{ id: string; name?: string; participantType?: string }>;
  /** The player's sheet modifier for the check's ability, which the popup displays. */
  checkModifier: number;
  /** Which way a shove lands, chosen by the player in the confirm. */
  shoveOutcome?: 'prone' | 'push';
  origin?: 'typed' | 'action_bar';
}

export interface CombatCheckClientOutcome {
  /** False when the sentence named no check the engine owns, so the turn continues as today. */
  declared: boolean;
  /** Set when the check resolved; absent when it was declined or there was nothing to do. */
  result?: unknown;
  /** The reason the check was not run, when it was recognised but not resolved. */
  reason?: 'dismissed' | 'no_target' | 'no_target_actor' | 'unrecognised_check' | 'refused';
  /** The engine's own words for a refusal, shown to the player as the reason. */
  message?: string;
}

/** The participant a resolved intent names, if the roster has it. */
function participantIdFor(
  targetName: string | undefined,
  participants: ReadonlyArray<{ id: string; name?: string }>,
): string | undefined {
  if (!targetName) return undefined;
  const normalized = targetName.trim().toLowerCase();
  return participants.find((entry) => entry.name?.trim().toLowerCase() === normalized)?.id;
}

/**
 * Run one mid-combat check, if the player's message declared one.
 *
 * Returns `{ declared: false }` for an ordinary message so the caller proceeds exactly as it did
 * before #2420 — an unrecognised check is logged with its reason code and then falls through,
 * never silently swallowed and never fabricated into a resolved check.
 */
export async function runDeclaredCombatCheck(
  playerMessage: string,
  context: CombatCheckClientContext,
): Promise<CombatCheckClientOutcome> {
  const targets = standingHostiles(context.participants);
  const detection = detectCombatCheck(
    playerMessage,
    targets.map((participant) => ({ name: participant.name ?? '' })),
  );

  if (!detection.intent) {
    if (detection.reason && detection.reason !== 'not_a_check') {
      logger.warn('[CombatCheck] mid-combat check not resolved', {
        reason: detection.reason,
        clause: detection.clause.slice(0, 120),
        encounterId: context.encounterId,
      });
    }
    return {
      declared: false,
      ...(detection.reason === 'unrecognised_check' || detection.reason === 'no_target_actor'
        ? { reason: detection.reason }
        : {}),
    };
  }

  const { intent } = detection;
  const targetId = participantIdFor(intent.targetName, targets);
  if (intent.kind !== 'hide' && intent.kind !== 'escape' && !targetId) {
    logger.warn('[CombatCheck] mid-combat check named no target on the roster', {
      reason: 'no_target_actor',
      targetName: intent.targetName ?? null,
      encounterId: context.encounterId,
    });
    return { declared: true, reason: 'no_target' };
  }

  const targetLabel = intent.targetName;
  const checkLabel =
    intent.kind === 'parley' && intent.parleySkill === 'intimidate'
      ? 'Intimidation'
      : CHECK_LABELS[intent.kind];

  // The one roll request: the same popup the skill checks use, reached through the bridge so its
  // result returns here rather than being posted to the DM as a fresh utterance.
  const outcome = await requestPlayerCheckRoll({
    actorLabel: context.actorLabel,
    checkLabel,
    checkModifier: context.checkModifier,
    ...(targetLabel ? { targetLabel } : {}),
  });

  if (outcome.cancelled) {
    logger.info('[CombatCheck] player dismissed the check prompt; the check does not resolve', {
      encounterId: context.encounterId,
      kind: intent.kind,
    });
    return { declared: true, reason: 'dismissed' };
  }

  const checkIntent: ClientCombatIntent = {
    type: 'check',
    actorId: context.actorId,
    checkKind: intent.kind,
    ...(targetId ? { targetId } : {}),
    ...(intent.parleySkill ? { parleySkill: intent.parleySkill } : {}),
    ...(intent.kind === 'shove' && context.shoveOutcome
      ? { shoveOutcome: context.shoveOutcome }
      : {}),
    // An absent d20 means the engine rolls the whole check, which is the timeout/no-popup path.
    ...(outcome.d20 !== null ? { d20: outcome.d20 } : {}),
  };

  try {
    const result = await executeAuthoritativeCombatIntent(
      context.encounterId,
      checkIntent,
      'dm',
      undefined,
      context.origin,
    );
    return { declared: true, result };
  } catch (error) {
    // A refusal (a target too large to shove, nothing to escape) cost the player nothing; the
    // engine's reason is the answer, not an error to throw the turn away on.
    if (!(error instanceof CombatIntentRefusedError)) throw error;
    logger.info('[CombatCheck] the engine refused the check', {
      kind: intent.kind,
      reason: error.details?.reason,
      encounterId: context.encounterId,
    });
    return { declared: true, reason: 'refused', message: error.message };
  }
}
