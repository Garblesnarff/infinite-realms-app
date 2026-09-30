/**
 * The small, deterministic part of combat narration that must not depend on the DM model.
 *
 * The server owns the numbers and attaches them to the intent result. This formatter turns those
 * facts into transcript text while deliberately leaving numeric HP out; the engine supplies the
 * condition tier instead.
 */
import { formatSpellEngineOutcome } from './combat-spell-transcript';
import {
  facingName,
  formatVersusArmorClass,
  playerFacingWeaponName,
  type EngineRosterEntry,
} from '../../../shared/engine-display-name';

export { formatRefusedSpellOutcome } from './combat-spell-transcript';

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

function weaponSwapLine(result: CombatEngineResult): string | null {
  const resolution = result.weaponResolution;
  if (
    !resolution?.substituted ||
    typeof resolution.requested !== 'string' ||
    !resolution.requested ||
    typeof resolution.resolved !== 'string' ||
    !resolution.resolved
  )
    return null;
  return `⚙️ Engine: Weapon swap: ${resolution.requested} → ${resolution.resolved} (requested weapon was not equipped).`;
}

function targetState(result: CombatEngineResult): string | null {
  if (result.targetIsDead === true) return 'dead';
  if (result.targetIsConscious === false) return 'unconscious';
  return result.targetCondition ?? null;
}

/** Format one authoritative attack or movement-only result for the player transcript. */
export function formatCombatEngineOutcome(
  action: CombatTranscriptAction,
  value: unknown,
  roster: readonly EngineRosterEntry[] = [],
  /** `targetHp`: the target is the player, whose own HP is theirs to see (#2378). */
  options: { targetHp?: boolean } = {},
): string | null {
  if (!isRecord(value)) return null;
  if (action.action_type === 'cast_spell') {
    return formatSpellEngineOutcome(action, value as CombatEngineResult, roster);
  }
  if (action.action_type !== 'attack') return null;
  const result = value as CombatEngineResult;
  const actor = facingName(result.actorName, action.actor_id, roster);
  const target = facingName(result.targetName, action.target_ids?.[0], roster);
  const lines = [weaponSwapLine(result)].filter((line): line is string => Boolean(line));

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
    lines.push(`⚙️ Engine: ${actor} ${movement}${spacing}; no attack was rolled.`);
    return lines.join('\n\n');
  }

  if (typeof result.hit !== 'boolean') return lines.length ? lines.join('\n\n') : null;

  const weapon =
    typeof result.weaponResolution?.resolved === 'string'
      ? ` with ${playerFacingWeaponName(result.weaponResolution.resolved, actor)}`
      : '';
  const roll =
    isFiniteNumber(result.d20) &&
    isFiniteNumber(result.attackBonus) &&
    isFiniteNumber(result.totalAttackRoll) &&
    isFiniteNumber(result.targetAC)
      ? `rolled ${result.d20} ${formatModifier(result.attackBonus)} = ${result.totalAttackRoll} ${formatVersusArmorClass(result)}`
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
  if (options.targetHp && result.hit && isFiniteNumber(result.targetNewHp)) {
    line += ` ${target} is now at ${result.targetNewHp} HP${state ? ` and is ${state}` : ''}.`;
  } else if (state) {
    line += ` ${target} is ${state}.`;
  }
  lines.push(line);
  return lines.join('\n\n');
}

/** The engine lines one NPC turn printed: its own outcome, then the server's extra lines. */
export function formatNpcTurnLines(
  npcResult: { action: CombatTranscriptAction; engineResult?: unknown; transcriptLines?: string[] },
  roster: readonly EngineRosterEntry[],
  options: { targetHp?: boolean } = {},
): string[] {
  const outcome = formatCombatEngineOutcome(
    npcResult.action,
    npcResult.engineResult,
    roster,
    options,
  );
  return [...(outcome ? [outcome] : []), ...(npcResult.transcriptLines ?? [])];
}

/** Put engine facts before model prose so option parsing cannot discard them as trailing text. */
export function prependCombatEngineTranscript(text: string, lines: readonly string[]): string {
  const facts = lines.filter(Boolean);
  if (!facts.length) return text;
  return `${facts.join('\n\n')}${text ? `\n\n${text}` : ''}`;
}
