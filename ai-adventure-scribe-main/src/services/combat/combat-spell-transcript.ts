import {
  facingName,
  formatVersusArmorClass,
  type EngineRosterEntry,
} from '../../../shared/engine-display-name';

import type { CombatEngineResult, CombatTranscriptAction } from './combat-outcome-transcript';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function targetState(result: CombatEngineResult): string | null {
  if (result.targetIsDead === true) return 'dead';
  if (result.targetIsConscious === false) return 'unconscious';
  return result.targetCondition ?? null;
}

export function displaySaveAbility(ability: string): string {
  const names: Record<string, string> = {
    str: 'STR',
    strength: 'STR',
    dex: 'DEX',
    dexterity: 'DEX',
    con: 'CON',
    constitution: 'CON',
    int: 'INT',
    intelligence: 'INT',
    wis: 'WIS',
    wisdom: 'WIS',
    cha: 'CHA',
    charisma: 'CHA',
  };
  return names[ability.toLowerCase()] ?? ability.toUpperCase();
}

function spellTargetTrailer(target: string, result: CombatEngineResult): string {
  if (result.targetNewHp == null) {
    const state = targetState(result);
    return state ? ` ${target} is ${state}.` : '';
  }
  const state = result.targetIsDead
    ? ' and is DEAD'
    : result.targetIsConscious === false
      ? ' and is UNCONSCIOUS'
      : '';
  return ` ${target} is now at ${result.targetNewHp} HP${state}.`;
}

function formatSpellOutcome(
  action: CombatTranscriptAction,
  result: CombatEngineResult,
  roster: readonly EngineRosterEntry[] = [],
  targetId: string | undefined,
): string | null {
  const actor = facingName(result.actorName, action.actor_id, roster);
  const target = facingName(result.targetName, targetId, roster);
  const spell = result.spellName ?? 'a spell';
  const damage = isFiniteNumber(result.finalDamage)
    ? `${result.finalDamage}${result.damageType ? ` ${result.damageType}` : ''} damage.`
    : result.hit === false
      ? 'No damage.'
      : '';
  const trailer = spellTargetTrailer(target, result);

  if (result.autoHit === true) {
    return `⚙️ Engine: ${actor} cast ${spell} at ${target} — AUTO-HIT.${damage ? ` ${damage}` : ''}${trailer}`;
  }
  if (result.saveAbility && isFiniteNumber(result.saveRoll) && isFiniteNumber(result.saveDC)) {
    const outcome = result.saved ? 'PASS' : 'FAIL';
    return (
      `⚙️ Engine: ${actor} cast ${spell} at ${target} — ${displaySaveAbility(result.saveAbility)} ` +
      `save ${result.saveRoll} vs DC ${result.saveDC} — ${outcome}.${damage ? ` ${damage}` : ''}${trailer}`
    );
  }
  if (
    isFiniteNumber(result.d20) &&
    isFiniteNumber(result.attackBonus) &&
    isFiniteNumber(result.totalAttackRoll)
  ) {
    const outcome = result.isCritical && result.hit ? 'CRITICAL HIT' : result.hit ? 'HIT' : 'MISS';
    const missDamage = result.hit ? damage : 'No damage.';
    return (
      `⚙️ Engine: ${actor} cast ${spell} at ${target} — spell attack ${result.d20} + ${result.attackBonus} ` +
      `= ${result.totalAttackRoll} ${formatVersusArmorClass(result)} — ${outcome}.` +
      `${missDamage ? ` ${missDamage}` : ''}${trailer}`
    );
  }
  // A healing spell's result is `{hit: true, finalDamage: 0}` with no damage type.
  if (result.hit === true && result.finalDamage === 0 && !result.damageType) {
    return `⚙️ Engine: ${actor} cast ${result.spellName ?? 'a healing spell'} at ${target} — HEALS.${trailer}`;
  }
  if (typeof result.hit === 'boolean') {
    const outcome = result.hit ? 'HIT' : 'MISS';
    return `⚙️ Engine: ${actor} cast ${spell} at ${target} — ${outcome}.${damage ? ` ${damage}` : ''}${trailer}`;
  }
  return null;
}

export function formatSpellEngineOutcome(
  action: CombatTranscriptAction,
  result: CombatEngineResult,
  roster: readonly EngineRosterEntry[] = [],
): string | null {
  const outcomes = Array.isArray(result.results) ? result.results : [result];
  // Each result of an area spell belongs to its own target, in `target_ids` order.
  const lines = outcomes
    .map((outcome, index) =>
      formatSpellOutcome(action, outcome, roster, action.target_ids?.[index] ?? ''),
    )
    .filter((line): line is string => Boolean(line));
  return lines.length ? lines.join('\n\n') : null;
}

/** Format a refused player spell. `actorId` is resolved once, against the roster. */
export function formatRefusedSpellOutcome(
  actorId: string,
  spellName: string,
  reason: string,
  roster: readonly EngineRosterEntry[] = [],
): string {
  const actor = facingName(undefined, actorId, roster);
  return `⚙️ Engine: ${actor}'s spell "${spellName}" was refused (${reason}). No roll, no damage, no wound.`;
}
