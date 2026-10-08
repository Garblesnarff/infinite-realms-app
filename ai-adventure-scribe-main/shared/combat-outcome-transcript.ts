/**
 * The small, deterministic part of combat narration that must not depend on the DM model.
 *
 * The server owns the numbers and attaches them to the intent result. This formatter turns those
 * facts into transcript text. Numeric HP is left out and the engine supplies the condition tier
 * instead, except for a hit on the player, whose own HP is theirs to see (`targetHp`, #2378).
 */
import { formatSpellEngineParts } from './combat-spell-transcript';
import { describeDeathSave, describeWake } from './death-save-lines';
import {
  facingName,
  formatVersusArmorClass,
  playerFacingWeaponName,
  rosterEntryForParticipant,
  type EngineRosterEntry,
} from './engine-display-name';
import {
  damageAtZeroHpPart,
  damageEffectText,
  engineBadge,
  engineCardSide,
  playerHpOf,
  type EngineResultCard,
} from './engine-result-card';

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

type PlayerExitOutcome = {
  exit?: 'fled' | 'surrendered' | 'withdrew' | null;
  opportunityAttack?: {
    attackerName?: string;
    hit?: boolean;
    finalDamage?: number;
  } | null;
};

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
  /** Death-save failures added because the target was struck at 0 HP (#2457). */
  deathSaveFailuresAdded?: number;
  /** The target's death-save failure tally after those failures were added. */
  deathSavesFailures?: number;
  /** The blow's overflow past 0 HP reached the target's maximum: instant death (#2518). */
  instantDeath?: boolean;
  /** Damage left after 0 HP and the maximum it was judged against (#2640). */
  damageOverflow?: number;
  hpMaximum?: number;
  /** A melee blow within 5 ft on an unconscious target: an automatic critical hit (#2518). */
  autoCritOnDowned?: boolean;
  /** Why a non-natural-20 hit is critical: the target's condition (#2640). */
  autoCritReason?: 'unconscious' | 'paralyzed';
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
  const critical =
    result.autoCritReason !== undefined
      ? `CRITICAL HIT (the target is ${result.autoCritReason})`
      : 'CRITICAL HIT';
  const outcome = result.isCritical && result.hit ? critical : result.hit ? 'HIT' : 'MISS';
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
  // With HP on the card, the HP line already names the target, so the status line
  // under it does not name them again: "The Scholar · HP 0 of 7" then "Unconscious.",
  // not "The Scholar is unconscious." a second time in the same card (#2513).
  const status = hp
    ? terminal
      ? `${terminal.charAt(0).toUpperCase()}${terminal.slice(1)}.`
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
  // Damage at 0 HP adds death-save failures: the failure is its own engine line and card (#2457).
  const damageAtZero = damageAtZeroHpPart(result, target, actor);
  if (damageAtZero) parts.push(damageAtZero);
  return parts;
}

function formatPlayerExitParts(
  action: CombatTranscriptAction,
  value: Record<string, unknown>,
  roster: readonly EngineRosterEntry[],
): EngineTranscriptPart[] | null {
  if (action.action_type !== 'flee' && action.action_type !== 'yield') return null;
  if (!('exit' in value) && !('opportunityAttack' in value)) return null;

  const outcome = value as PlayerExitOutcome;
  const actor = facingName(undefined, action.actor_id, roster);
  const parts: EngineTranscriptPart[] = [];
  const opportunityAttack = outcome.opportunityAttack;
  if (
    opportunityAttack &&
    typeof opportunityAttack.attackerName === 'string' &&
    typeof opportunityAttack.hit === 'boolean'
  ) {
    parts.push(
      ...formatCombatEngineParts(
        {
          actor_id: opportunityAttack.attackerName,
          action_type: 'attack',
          target_ids: [actor],
        },
        {
          actorName: opportunityAttack.attackerName,
          targetName: actor,
          hit: opportunityAttack.hit,
          finalDamage: isFiniteNumber(opportunityAttack.finalDamage)
            ? opportunityAttack.finalDamage
            : 0,
        },
        roster,
        { targetHp: true },
      ),
    );
  }

  const exitLine =
    outcome.exit === 'fled'
      ? `⚙️ Engine: ${actor} fled from combat.`
      : outcome.exit === 'surrendered'
        ? `⚙️ Engine: ${actor} yielded.`
        : outcome.exit === 'withdrew'
          ? `⚙️ Engine: ${actor} withdrew from combat.`
          : `⚙️ Engine: ${actor} did not get away; they are downed.`;
  parts.push({
    line: exitLine,
    card: {
      kind: 'move',
      side: 'party',
      line: exitLine,
      title:
        outcome.exit === 'fled'
          ? `${actor} fled from combat`
          : outcome.exit === 'surrendered'
            ? `${actor} yielded`
            : outcome.exit === 'withdrew'
              ? `${actor} withdrew from combat`
              : `${actor} did not get away; downed`,
    },
  });
  return parts;
}

/** Format any action-bar engine result, including tactical movement results. */
export function formatCombatActionParts(
  action: CombatTranscriptAction,
  value: unknown,
  roster: readonly EngineRosterEntry[] = [],
  options: EngineOutcomeOptions = {},
): EngineTranscriptPart[] {
  const combatParts = formatCombatEngineParts(action, value, roster, options);
  if (combatParts.length || !isRecord(value)) return combatParts;

  const playerExitParts = formatPlayerExitParts(action, value, roster);
  if (playerExitParts) return playerExitParts;

  if (action.action_type === 'move') {
    const path = Array.isArray(value.path) ? value.path : [];
    const destination = path.at(-1);
    if (isRecord(destination) && isFiniteNumber(destination.x) && isFiniteNumber(destination.y)) {
      const actor = facingName(undefined, action.actor_id, roster);
      const line = `⚙️ Engine: ${actor} moved to (${destination.x}, ${destination.y}).`;
      return [
        {
          line,
          card: {
            kind: 'move',
            side: engineCardSide(action.actor_id, roster, false),
            line,
            title: `${actor} moves to (${destination.x}, ${destination.y})`,
          },
        },
      ];
    }
  }

  const verb: Record<string, string> = {
    dash: 'dashed',
    dodge: 'dodged',
    disengage: 'disengaged',
    flee: 'fled from combat',
    yield: 'yielded',
  };
  const actionVerb = verb[action.action_type ?? ''];
  if (!actionVerb) return [];
  const actor = facingName(undefined, action.actor_id, roster);
  const line = `⚙️ Engine: ${actor} ${actionVerb}.`;
  return [
    {
      line,
      card: {
        kind: 'move',
        side: engineCardSide(action.actor_id, roster, false),
        line,
        title: `${actor} ${actionVerb}`,
      },
    },
  ];
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

/**
 * One death-save card. The NPC-turn card covers the line the server already printed;
 * the single-action card carries the line itself.
 */
function deathSaveCard(
  name: string,
  save: EngineDeathSave,
  line: string,
  covers?: string[],
): EngineResultCard {
  const detail = save.wasRevived
    ? `Rolled a natural 20: ${name} is back on their feet at 1 HP.`
    : save.isDead
      ? `Rolled ${save.roll}: the third failure. ${name} is dead.`
      : save.isStabilized
        ? `Rolled ${save.roll}: the third success. ${name} is stable.`
        : `Rolled ${save.roll}.`;
  return {
    kind: 'death_save',
    side: 'party',
    line,
    ...(covers ? { covers } : {}),
    title: `${name} makes a death saving throw`,
    badge: engineBadge(save.isSuccess ? 'death-save-passed' : 'death-save-failed', 'party'),
    detail,
    deathSave: { successes: save.successes ?? 0, failures: save.failures ?? 0 },
  };
}

/**
 * The player-visible engine lines and cards for death saves on a single executed
 * action (#2457). The NPC-turn path keeps pairing its cards against the server's
 * printed lines; a single action was never given server lines, so the card carries
 * the line itself.
 */
export function formatDeathSaveParts(
  value: unknown,
  roster: readonly EngineRosterEntry[] = [],
): EngineTranscriptPart[] {
  const saves = (
    isRecord(value) && Array.isArray(value.deathSaves) ? value.deathSaves : []
  ) as EngineDeathSave[];
  return saves.flatMap((save) => {
    if (!save || !isFiniteNumber(save.roll)) return [];
    const name = facingName(undefined, save.participantId, roster);
    // The Engine: prefix marks this as engine fact, not DM fiction (#2457).
    const line = `⚙️ Engine: ${describeDeathSave(name, save)}`;
    return [{ line, card: deathSaveCard(name, save, line) }];
  });
}

/**
 * The line and card for a stable hero waking after a fight that ended on them (#2518): the engine
 * rolled the 1d4 hours and put them back on 1 HP. Carried on the result that ended the fight.
 */
export function formatWakeParts(value: unknown): EngineTranscriptPart[] {
  const wakes = (isRecord(value) && Array.isArray(value.wake) ? value.wake : []) as Array<{
    name?: string;
    hours?: number;
  }>;
  return wakes.flatMap((wake) => {
    if (typeof wake?.name !== 'string' || !isFiniteNumber(wake.hours)) return [];
    const description = describeWake(wake.name, wake.hours);
    const line = `⚙️ Engine: ${description}`;
    return [
      {
        line,
        card: {
          kind: 'death_save' as const,
          side: 'party' as const,
          line,
          title: `${wake.name} wakes`,
          detail: description,
        },
      },
    ];
  });
}

/** Explain the authoritative reason for a terminal combat boundary. */
export function formatCombatEndLine(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const explanation: Record<string, string> = {
    last_hostile_defeated: 'the last hostile was defeated',
    party_defeated: 'the party was defeated',
    death_save_failed: 'a death save ended the fight',
  };
  return `⚙️ Engine: Combat ended — ${explanation[reason] ?? reason} (reason: ${reason}).`;
}

/** Put engine facts before model prose so option parsing cannot discard them as trailing text. */
export function prependCombatEngineTranscript(text: string, lines: readonly string[]): string {
  const facts = lines.filter(Boolean);
  if (!facts.length) return text;
  return `${facts.join('\n\n')}${text ? `\n\n${text}` : ''}`;
}
