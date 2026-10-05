/**
 * What the engine did to whom, in the words the DM narrates from.
 *
 * The only import is the pure AC phrase. Callers pull in the combat logger, which pulls in
 * the shared pino instance — enough of a graph that a test wanting to assert on this one
 * string could not import it without the whole chain, and in the server suite that chain is
 * poisoned by a process-wide `mock.module` leak from an unrelated file.
 */
import { formatVersusArmorClass } from '../../../../shared/engine-display-name';

export type DamageScale = 'scratch' | 'wounded' | 'grievous';

export function damageScaleForDamage(
  damage: number | undefined,
  targetMaxHitPoints: number | undefined,
): DamageScale | undefined {
  if (
    !Number.isFinite(damage) ||
    damage == null ||
    damage <= 0 ||
    !Number.isFinite(targetMaxHitPoints) ||
    targetMaxHitPoints == null ||
    targetMaxHitPoints <= 0
  )
    return undefined;
  const fraction = (damage ?? 0) / targetMaxHitPoints;
  if (fraction < 0.25) return 'scratch';
  if (fraction <= 0.6) return 'wounded';
  return 'grievous';
}
/**
 * The sentence the DM reads after an attack the engine actually rolled.
 *
 * Until now the only thing that ever reached `<engine_resolved_outcomes>` was an approach that
 * fell short, so a landed blow told the model nothing at all. Run 9's byte-identical paragraph
 * loop (seq 12 == seq 20, verbatim) is what feedback starvation looks like from the outside:
 * the model repeated itself because nothing ever confirmed that anything had happened.
 */
export function describeResolvedAttack(
  actorLabel: string,
  targetLabel: string,
  outcome: {
    hit?: boolean;
    finalDamage?: number;
    targetNewHp?: number;
    targetMaxHitPoints?: number;
    isCritical?: boolean;
    /** Set when the crit is the unconscious / paralyzed rule rather than a natural 20 (#2640). */
    autoCritReason?: 'unconscious' | 'paralyzed';
    targetIsDead?: boolean;
    targetIsConscious?: boolean;
    autoRolled?: boolean;
  },
  weaponName?: string,
): string {
  const weapon = weaponName ? ` with its ${weaponName}` : '';
  // Said out loud, never inferred. The player's own attack die is theirs to throw; when they
  // left the popup and the engine threw it for them, the record has to admit that rather than
  // present an engine die as the player's. A player who cannot tell the difference has to
  // wonder whether any of the dice are real.
  const auto = outcome.autoRolled ? ' (auto-rolled)' : '';
  if (!outcome.hit)
    return `${actorLabel} attacked ${targetLabel}${weapon} and MISSED${auto}. No damage.`;
  const crit = outcome.isCritical
    ? outcome.autoCritReason
      ? `CRITICAL HIT (the target is ${outcome.autoCritReason})`
      : 'CRITICAL HIT'
    : 'HIT';
  const damage = Number(outcome.finalDamage ?? 0);
  const damageScale = damageScaleForDamage(damage, outcome.targetMaxHitPoints);
  const hp =
    outcome.targetNewHp == null ? '' : ` ${targetLabel} is now at ${outcome.targetNewHp} HP`;
  const state = outcome.targetIsDead
    ? ` and is DEAD`
    : outcome.targetIsConscious === false
      ? ` and is UNCONSCIOUS`
      : '';
  return (
    `${actorLabel} attacked ${targetLabel}${weapon}: ${crit}${auto} for ${damage} damage.${hp}${state}.` +
    (damageScale
      ? ` Damage scale cue: ${damageScale} (${damageScale === 'scratch' ? '<25%' : damageScale === 'wounded' ? '25–60%' : '>60%'} of target max HP).`
      : '') +
    ' ' +
    'Narrate this outcome; it already happened.'
  );
}

export type ResolvedSpellOutcome = {
  hit?: boolean;
  d20?: number;
  attackBonus?: number;
  totalAttackRoll?: number;
  targetAC?: number;
  baseAc?: number;
  coverBonus?: number;
  cover?: number | null;
  saveAbility?: string;
  saveRoll?: number;
  saveDC?: number;
  saved?: boolean;
  autoHit?: boolean;
  finalDamage?: number;
  damageType?: string;
  targetNewHp?: number;
  targetIsConscious?: boolean;
  targetIsDead?: boolean;
};

const displaySaveAbility = (ability: string): string => {
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
};

const damageLine = (outcome: ResolvedSpellOutcome): string => {
  const damage = Number(outcome.finalDamage ?? 0);
  return damage > 0 ? `${damage} ${outcome.damageType ?? 'untyped'} damage.` : 'No damage.';
};

const authoritativeSpellTrailer = (targetLabel: string, outcome: ResolvedSpellOutcome): string => {
  const hp =
    outcome.targetNewHp == null ? '' : `${targetLabel} is now at ${outcome.targetNewHp} HP`;
  const state = outcome.targetIsDead
    ? 'is DEAD'
    : outcome.targetIsConscious === false
      ? 'is UNCONSCIOUS'
      : '';
  const targetFacts = [hp, state].filter(Boolean).join(' and ');
  return `${targetFacts ? `${targetFacts}. ` : ''}Narrate this outcome; it already happened.`;
};

const resolvedSpellLine = (
  targetLabel: string,
  outcome: ResolvedSpellOutcome,
  resolution: string,
): string =>
  `${resolution} ${damageLine(outcome)} ${authoritativeSpellTrailer(targetLabel, outcome)}`;

/** The engine line the DM receives for one of the bounded player spell actions. */
export function describeResolvedSpell(
  actorLabel: string,
  targetLabel: string,
  spellName: string,
  outcome: ResolvedSpellOutcome,
  showTargetNumbers: boolean,
): string {
  if (outcome.autoHit) {
    return resolvedSpellLine(
      targetLabel,
      outcome,
      `${actorLabel} cast ${spellName} at ${targetLabel} — AUTO-HIT.`,
    );
  }
  if (outcome.saveAbility && outcome.saveRoll != null && outcome.saveDC != null) {
    const result = outcome.saved ? 'PASS' : 'FAIL';
    // The save's DC is a target number: on a campaign that hides them the DM is never
    // told it, or it will say it. The target's own roll stays either way.
    const versus = showTargetNumbers ? ` vs DC ${outcome.saveDC}` : '';
    return resolvedSpellLine(
      targetLabel,
      outcome,
      `${actorLabel} cast ${spellName} at ${targetLabel} — ${displaySaveAbility(
        outcome.saveAbility,
      )} save ${outcome.saveRoll}${versus} — ${result}.`,
    );
  }
  if (outcome.d20 != null && outcome.attackBonus != null && outcome.totalAttackRoll != null) {
    const result = outcome.hit ? 'HIT' : 'MISS';
    // Same rule for AC, and an unknown AC drops the clause rather than printing
    // "vs AC ?": an unknown target number is not a number the DM can be told.
    const versus =
      showTargetNumbers && outcome.targetAC != null && Number.isFinite(outcome.targetAC)
        ? ` ${formatVersusArmorClass(outcome)}`
        : '';
    return resolvedSpellLine(
      targetLabel,
      outcome,
      `${actorLabel} cast ${spellName} at ${targetLabel} — spell attack ${outcome.d20} + ${
        outcome.attackBonus
      } = ${outcome.totalAttackRoll}${versus} — ${result}.`,
    );
  }
  return resolvedSpellLine(
    targetLabel,
    outcome,
    `${actorLabel} cast ${spellName} at ${targetLabel} — NO RESULT.`,
  );
}

/** A refused spell is an engine fact, never an invitation for the DM to fill in an outcome. */
export function describeRefusedSpell(
  actorLabel: string,
  spellName: string,
  reason: string,
): string {
  return `Engine: ${actorLabel}'s spell "${spellName}" was refused (${reason}). No roll, no damage, no wound.`;
}
