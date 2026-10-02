import {
  damageAtZeroHpPart,
  damageEffectText,
  engineBadge,
  engineCardSide,
  playerHpOf,
  type EngineResultCard,
} from './engine-result-card';
import {
  facingName,
  formatVersusArmorClass,
  type EngineRosterEntry,
} from '../../../shared/engine-display-name';

import type {
  CombatEngineResult,
  CombatTranscriptAction,
  EngineOutcomeOptions,
  EngineTranscriptPart,
} from './combat-outcome-transcript';

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

function terminalStatus(target: string, result: CombatEngineResult): string | undefined {
  if (result.targetIsDead) return `${target} is dead.`;
  if (result.targetIsConscious === false) return `${target} is unconscious.`;
  return undefined;
}

function formatSpellPart(
  action: CombatTranscriptAction,
  result: CombatEngineResult,
  roster: readonly EngineRosterEntry[] = [],
  targetId: string | undefined,
  options: EngineOutcomeOptions,
): EngineTranscriptPart | null {
  const actor = facingName(result.actorName, action.actor_id, roster);
  const target = facingName(result.targetName, targetId, roster);
  const spell = result.spellName ?? 'a spell';
  const side = engineCardSide(action.actor_id, roster, options.targetHp === true);
  const damage = isFiniteNumber(result.finalDamage)
    ? `${result.finalDamage}${result.damageType ? ` ${result.damageType}` : ''} damage.`
    : result.hit === false
      ? 'No damage.'
      : '';
  const trailer = spellTargetTrailer(target, result);
  const hp = playerHpOf(result, target, options);
  const card = (
    line: string,
    parts: Pick<EngineResultCard, 'badge' | 'math' | 'effect'> & { title?: string },
  ): EngineTranscriptPart => {
    const status = hp ? terminalStatus(target, result) : trailer.trim() || undefined;
    const { title, ...rest } = parts;
    return {
      line,
      card: {
        kind: 'spell',
        side,
        line,
        title: title ?? `${actor} casts ${spell} at ${target}`,
        ...rest,
        ...(hp ? { hp } : {}),
        ...(status ? { status } : {}),
      },
    };
  };
  const effect = damageEffectText(result);

  if (result.autoHit === true) {
    return card(
      `⚙️ Engine: ${actor} cast ${spell} at ${target} — AUTO-HIT.${damage ? ` ${damage}` : ''}${trailer}`,
      { badge: engineBadge('auto-hit', side), effect },
    );
  }
  if (result.saveAbility && isFiniteNumber(result.saveRoll) && isFiniteNumber(result.saveDC)) {
    const outcome = result.saved ? 'PASS' : 'FAIL';
    return card(
      `⚙️ Engine: ${actor} cast ${spell} at ${target} — ${displaySaveAbility(result.saveAbility)} ` +
        `save ${result.saveRoll} vs DC ${result.saveDC} — ${outcome}.${damage ? ` ${damage}` : ''}${trailer}`,
      {
        badge: engineBadge(result.saved ? 'target-saved' : 'target-failed', side),
        math: {
          kind: 'save',
          ability: displaySaveAbility(result.saveAbility),
          roll: result.saveRoll,
          dc: result.saveDC,
        },
        effect,
      },
    );
  }
  if (
    isFiniteNumber(result.d20) &&
    isFiniteNumber(result.attackBonus) &&
    isFiniteNumber(result.totalAttackRoll)
  ) {
    const outcome = result.isCritical && result.hit ? 'CRITICAL HIT' : result.hit ? 'HIT' : 'MISS';
    const missDamage = result.hit ? damage : 'No damage.';
    return card(
      `⚙️ Engine: ${actor} cast ${spell} at ${target} — spell attack ${result.d20} + ${result.attackBonus} ` +
        `= ${result.totalAttackRoll} ${formatVersusArmorClass(result)} — ${outcome}.` +
        `${missDamage ? ` ${missDamage}` : ''}${trailer}`,
      {
        badge: engineBadge(
          result.isCritical && result.hit ? 'critical' : result.hit ? 'hit' : 'miss',
          side,
        ),
        math: {
          kind: 'attack',
          d20: result.d20,
          bonus: result.attackBonus,
          total: result.totalAttackRoll,
          ac: {
            targetAC: result.targetAC,
            baseAc: result.baseAc,
            coverBonus: result.coverBonus,
            cover: result.cover,
          },
          targetIsPlayer: options.targetHp === true,
        },
        effect,
      },
    );
  }
  // A healing spell's result is `{hit: true, finalDamage: 0}` with no damage type.
  if (result.hit === true && result.finalDamage === 0 && !result.damageType) {
    return card(
      `⚙️ Engine: ${actor} cast ${result.spellName ?? 'a healing spell'} at ${target} — HEALS.${trailer}`,
      {
        title: `${actor} casts ${result.spellName ?? 'a healing spell'} at ${target}`,
        badge: engineBadge('heals', side),
      },
    );
  }
  if (typeof result.hit === 'boolean') {
    const outcome = result.hit ? 'HIT' : 'MISS';
    return card(
      `⚙️ Engine: ${actor} cast ${spell} at ${target} — ${outcome}.${damage ? ` ${damage}` : ''}${trailer}`,
      { badge: engineBadge(result.hit ? 'hit' : 'miss', side), effect },
    );
  }
  return null;
}

export function formatSpellEngineParts(
  action: CombatTranscriptAction,
  result: CombatEngineResult,
  roster: readonly EngineRosterEntry[] = [],
  options: EngineOutcomeOptions = {},
): EngineTranscriptPart[] {
  const outcomes = Array.isArray(result.results) ? result.results : [result];
  // Each result of an area spell belongs to its own target, in `target_ids` order.
  // Damage at 0 HP adds death-save failures: the failure is its own engine line and card (#2457).
  return outcomes.flatMap((outcome, index) => {
    const targetId = action.target_ids?.[index] ?? '';
    const spellPart = formatSpellPart(action, outcome, roster, targetId, options);
    const parts = spellPart ? [spellPart] : [];
    const damageAtZero = damageAtZeroHpPart(
      outcome,
      facingName(outcome.targetName, targetId, roster),
    );
    if (damageAtZero) parts.push(damageAtZero);
    return parts;
  });
}

/** A refused player spell: the line and its card. `actorId` is resolved once, against the roster. */
export function formatRefusedSpellPart(
  actorId: string,
  spellName: string,
  reason: string,
  roster: readonly EngineRosterEntry[] = [],
): EngineTranscriptPart {
  const actor = facingName(undefined, actorId, roster);
  const line = `⚙️ Engine: ${actor}'s spell "${spellName}" was refused (${reason}). No roll, no damage, no wound.`;
  const side = engineCardSide(actorId, roster, false);
  return {
    line,
    card: {
      kind: 'refused',
      side,
      line,
      title: `${actor}'s ${spellName} was refused`,
      badge: engineBadge('refused', side),
      detail: `${reason}. No roll, no damage, no wound.`,
    },
  };
}

/** Format a refused player spell. `actorId` is resolved once, against the roster. */
export function formatRefusedSpellOutcome(
  actorId: string,
  spellName: string,
  reason: string,
  roster: readonly EngineRosterEntry[] = [],
): string {
  return formatRefusedSpellPart(actorId, spellName, reason, roster).line;
}
