/**
 * The small, deterministic part of combat narration that must not depend on the DM model.
 *
 * The server owns the numbers and attaches them to the intent result. This formatter turns those
 * facts into transcript text. Numeric HP is left out and the engine supplies the condition tier
 * instead, except for a hit on the player, whose own HP is theirs to see (`targetHp`, #2378).
 */
import { formatSpellEngineParts } from './combat-spell-transcript';
import {
  damageEffectText,
  engineBadge,
  engineCardSide,
  playerHpOf,
  type EngineResultCard,
} from './engine-result-card';
import { isPlayerActor } from './player-attack-roll';
import {
  facingName,
  formatVersusArmorClass,
  playerFacingWeaponName,
  rosterEntryForParticipant,
  type EngineRosterEntry,
} from '../../../shared/engine-display-name';

export { formatRefusedSpellOutcome, formatRefusedSpellPart } from './combat-spell-transcript';

/** One engine result as the player reads it: the transcript line and the card built beside it. */
export interface EngineTranscriptPart {
  line: string;
  card: EngineResultCard;
}

export interface EngineOutcomeOptions {
  /** The target is the player, whose own HP is theirs to see (#2378). */
  targetHp?: boolean;
  /** The player's maximum HP, for the HP bar on a card where the player is hit. */
  targetMaxHp?: number;
}

export interface CombatTranscriptAction {
  action_type?: string;
  actor_id?: string;
  target_ids?: string[];
}

export interface CombatEngineResult {
  resolvedAs?: string;
  actorName?: string;
  targetName?: string;
  movedFeet?: number;
  distanceFeet?: number;
  reachFeet?: number;
  d20?: number;
  attackBonus?: number;
  totalAttackRoll?: number;
  targetAC?: number;
  /** Seated armor class, before cover. The tracker shows this. */
  baseAc?: number;
  /** Added to {@link baseAc} to reach {@link targetAC}. Zero when there is no cover. */
  coverBonus?: number;
  /** Tactical cover grade 0–3. 1 is half cover (+2), 2 is three-quarters (+5). */
  cover?: number | null;
  hit?: boolean;
  finalDamage?: number;
  damageType?: string;
  isCritical?: boolean;
  targetCondition?: 'unharmed' | 'wounded' | 'bloodied' | 'near death';
  targetIsConscious?: boolean;
  targetIsDead?: boolean;
  targetNewHp?: number;
  autoRolled?: boolean;
  spellName?: string;
  saveAbility?: string;
  saveRoll?: number;
  saveDC?: number;
  saved?: boolean;
  autoHit?: boolean;
  results?: CombatEngineResult[];
  weaponResolution?: {
    requested?: string | null;
    resolved?: string;
    substituted?: boolean;
  };
  /** One entry per death saving throw rolled at the turn boundary. */
  deathSaves?: EngineDeathSave[];
}

export interface EngineDeathSave {
  participantId?: string;
  roll?: number;
  isSuccess?: boolean;
  isCritical?: boolean;
  successes?: number;
  failures?: number;
  isStabilized?: boolean;
  isDead?: boolean;
  wasRevived?: boolean;
}

type EngineParticipant = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  participantType?: string | null;
  maxHitPoints?: number;
  monsterAttack?: unknown;
};

/** The roster for engine lines and cards: the names, and the side each participant is on. */
export function engineRosterOf(
  participants: readonly EngineParticipant[] | undefined,
): EngineRosterEntry[] {
  return (participants ?? []).map((participant) => ({
    ...rosterEntryForParticipant(participant),
    participantType: participant.participantType ?? null,
  }));
}

/** What an NPC turn's outcome needs to know: is the target the player, and how much HP do they have. */
export function npcTurnOptions(
  participants: readonly EngineParticipant[] | undefined,
  targetId: string | undefined,
): EngineOutcomeOptions {
  const targetIsPlayer = isPlayerActor(targetId ?? '', participants as never);
  if (!targetIsPlayer) return { targetHp: false };
  const player = participants?.find((participant) => participant.participantType === 'player');
  return { targetHp: true, targetMaxHp: player?.maxHitPoints };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatModifier(value: number): string {
  return value < 0 ? `- ${Math.abs(value)}` : `+ ${value}`;
}

function targetState(result: CombatEngineResult): string | null {
  if (result.targetIsDead === true) return 'dead';
  if (result.targetIsConscious === false) return 'unconscious';
  return result.targetCondition ?? null;
}

function weaponSwapPart(
  result: CombatEngineResult,
  actor: string,
  side: EngineResultCard['side'],
): EngineTranscriptPart | null {
  const resolution = result.weaponResolution;
  if (
    !resolution?.substituted ||
    typeof resolution.requested !== 'string' ||
    !resolution.requested ||
    typeof resolution.resolved !== 'string' ||
    !resolution.resolved
  )
    return null;
  const line = `⚙️ Engine: Weapon swap: ${resolution.requested} → ${resolution.resolved} (requested weapon was not equipped).`;
  return {
    line,
    card: {
      kind: 'weapon_swap',
      side,
      line,
      title: `${actor} swaps ${resolution.requested} for ${resolution.resolved}`,
      detail: 'The requested weapon was not equipped.',
    },
  };
}

/** Format one authoritative attack or movement-only result as transcript lines and cards. */
export function formatCombatEngineParts(
  action: CombatTranscriptAction,
  value: unknown,
  roster: readonly EngineRosterEntry[] = [],
  options: EngineOutcomeOptions = {},
): EngineTranscriptPart[] {
  if (!isRecord(value)) return [];
  if (action.action_type === 'cast_spell') {
    return formatSpellEngineParts(action, value as CombatEngineResult, roster, options);
  }
  if (action.action_type !== 'attack') return [];
  const result = value as CombatEngineResult;
  const actor = facingName(result.actorName, action.actor_id, roster);
  const target = facingName(result.targetName, action.target_ids?.[0], roster);
  const side = engineCardSide(action.actor_id, roster, options.targetHp === true);
  const parts: EngineTranscriptPart[] = [];
  const swap = weaponSwapPart(result, actor, side);
  if (swap) parts.push(swap);

  if (result.resolvedAs === 'movement_only') {
    const movement = isFiniteNumber(result.movedFeet)
      ? result.movedFeet > 0
        ? `moved ${result.movedFeet} ft toward ${target}`
        : `could not move closer to ${target}`
      : `could not reach ${target}`;
    const spacing =
      isFiniteNumber(result.distanceFeet) && isFiniteNumber(result.reachFeet)
        ? `; distance ${result.distanceFeet} ft (reach ${result.reachFeet} ft)`
        : '';
    const line = `⚙️ Engine: ${actor} ${movement}${spacing}; no attack was rolled.`;
    parts.push({
      line,
      card: {
        kind: 'move',
        side,
        line,
        title: `${actor} ${movement.replace(/^moved /, 'moves ')}. No attack this turn.`,
      },
    });
    return parts;
  }

  if (typeof result.hit !== 'boolean') return parts;

  const weaponName =
    typeof result.weaponResolution?.resolved === 'string'
      ? playerFacingWeaponName(result.weaponResolution.resolved, actor)
      : null;
  const weapon = weaponName ? ` with ${weaponName}` : '';
  const hasRoll =
    isFiniteNumber(result.d20) &&
    isFiniteNumber(result.attackBonus) &&
    isFiniteNumber(result.totalAttackRoll) &&
    isFiniteNumber(result.targetAC);
  const roll = hasRoll
    ? `rolled ${result.d20} ${formatModifier(result.attackBonus as number)} = ${result.totalAttackRoll} ${formatVersusArmorClass(result)}`
    : `resolved an attack against ${target}`;
  const outcome = result.isCritical && result.hit ? 'CRITICAL HIT' : result.hit ? 'HIT' : 'MISS';
  const auto = result.autoRolled === true ? ' (auto-rolled)' : '';
  let line = `⚙️ Engine: ${actor} ${roll}${roll.startsWith('rolled ') ? ` against ${target}` : ''}${weapon} — ${outcome}${auto}.`;
  if (result.hit) {
    const damage = isFiniteNumber(result.finalDamage) ? result.finalDamage : 0;
    line += ` ${damage}${result.damageType ? ` ${result.damageType}` : ''} damage.`;
  } else {
    line += ' No damage.';
  }
  const state = targetState(result);
  const hp = result.hit ? playerHpOf(result, target, options) : undefined;
  if (options.targetHp && result.hit && isFiniteNumber(result.targetNewHp)) {
    line += ` ${target} is now at ${result.targetNewHp} HP${state ? ` and is ${state}` : ''}.`;
  } else if (state) {
    line += ` ${target} is ${state}.`;
  }
  const terminal = state === 'dead' || state === 'unconscious' ? state : null;
  const status = hp
    ? terminal
      ? `${target} is ${terminal}.`
      : undefined
    : state
      ? `${target} is ${state}.`
      : undefined;
  parts.push({
    line,
    card: {
      kind: 'attack',
      side,
      line,
      title: `${actor} attacks ${target}${weapon}`,
      badge: engineBadge(
        result.isCritical && result.hit ? 'critical' : result.hit ? 'hit' : 'miss',
        side,
      ),
      ...(hasRoll
        ? {
            math: {
              kind: 'attack' as const,
              d20: result.d20 as number,
              bonus: result.attackBonus as number,
              total: result.totalAttackRoll as number,
              ac: {
                targetAC: result.targetAC,
                baseAc: result.baseAc,
                coverBonus: result.coverBonus,
                cover: result.cover,
              },
              targetIsPlayer: options.targetHp === true,
            },
          }
        : {}),
      effect: damageEffectText(result),
      ...(hp ? { hp } : {}),
      ...(status ? { status } : {}),
    },
  });
  return parts;
}

const joinedLines = (parts: readonly EngineTranscriptPart[]): string | null =>
  parts.length ? parts.map((part) => part.line).join('\n\n') : null;

/** Format one authoritative attack or movement-only result for the player transcript. */
export function formatCombatEngineOutcome(
  action: CombatTranscriptAction,
  value: unknown,
  roster: readonly EngineRosterEntry[] = [],
  /** `targetHp`: the target is the player, whose own HP is theirs to see (#2378). */
  options: EngineOutcomeOptions = {},
): string | null {
  return joinedLines(formatCombatEngineParts(action, value, roster, options));
}

function deathSaveCards(
  result: unknown,
  roster: readonly EngineRosterEntry[],
  printedLines: readonly string[],
): EngineResultCard[] {
  const saves = (
    isRecord(result) && Array.isArray(result.deathSaves) ? result.deathSaves : []
  ) as EngineDeathSave[];
  const paired = printedLines.length === saves.length;
  return saves.flatMap((save, index) => {
    if (!save || !isFiniteNumber(save.roll)) return [];
    const name = facingName(undefined, save.participantId, roster);
    const detail = save.wasRevived
      ? `Rolled a natural 20: ${name} is back on their feet at 1 HP.`
      : save.isDead
        ? `Rolled ${save.roll}: the third failure. ${name} is dead.`
        : save.isStabilized
          ? `Rolled ${save.roll}: the third success. ${name} is stable.`
          : `Rolled ${save.roll}.`;
    return [
      {
        kind: 'death_save' as const,
        side: 'party' as const,
        line: `⚙️ Engine: ${name} rolled ${save.roll} on a death saving throw — ${save.isSuccess ? 'PASSED' : 'FAILED'}.`,
        ...(paired ? { covers: [printedLines[index]] } : {}),
        title: `${name} makes a death saving throw`,
        badge: engineBadge(save.isSuccess ? 'death-save-passed' : 'death-save-failed', 'party'),
        detail,
        deathSave: { successes: save.successes ?? 0, failures: save.failures ?? 0 },
      },
    ];
  });
}

/** The engine lines one NPC turn printed (its own outcome, then the server's extra lines) and their cards. */
export function formatNpcTurnOutcome(
  npcResult: { action: CombatTranscriptAction; engineResult?: unknown; transcriptLines?: string[] },
  roster: readonly EngineRosterEntry[],
  options: EngineOutcomeOptions = {},
): { lines: string[]; cards: EngineResultCard[] } {
  const parts = formatCombatEngineParts(npcResult.action, npcResult.engineResult, roster, options);
  const outcome = joinedLines(parts);
  const printed = npcResult.transcriptLines ?? [];
  return {
    lines: [...(outcome ? [outcome] : []), ...printed],
    cards: [
      ...parts.map((part) => part.card),
      ...deathSaveCards(npcResult.engineResult, roster, printed),
    ],
  };
}

/** The engine lines one NPC turn printed: its own outcome, then the server's extra lines. */
export function formatNpcTurnLines(
  npcResult: { action: CombatTranscriptAction; engineResult?: unknown; transcriptLines?: string[] },
  roster: readonly EngineRosterEntry[],
  options: EngineOutcomeOptions = {},
): string[] {
  return formatNpcTurnOutcome(npcResult, roster, options).lines;
}

/** Put engine facts before model prose so option parsing cannot discard them as trailing text. */
export function prependCombatEngineTranscript(text: string, lines: readonly string[]): string {
  const facts = lines.filter(Boolean);
  if (!facts.length) return text;
  return `${facts.join('\n\n')}${text ? `\n\n${text}` : ''}`;
}
