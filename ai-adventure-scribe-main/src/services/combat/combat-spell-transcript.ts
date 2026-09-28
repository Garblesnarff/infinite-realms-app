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

function displaySaveAbility(ability: string): string {
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
): string | null {
  const actor = facingName(result.actorName, action.actor_id, roster);
  const target = facingName(result.targetName, action.target_ids?.[0], roster);
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
  const lines = outcomes
    .map((outcome) => formatSpellOutcome(action, outcome, roster))
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
