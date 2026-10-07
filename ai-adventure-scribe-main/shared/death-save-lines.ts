/**
 * The one death-save sentence (#2457).
 *
 * Shared because three places must print the same words: the server's DM fact
 * (`death-saves-service.ts`), the server's NPC-turn transcript lines
 * (`npc-turn-runner.ts`), and the client's single-action transcript
 * (`combat-outcome-transcript.ts`). Two copies of this sentence drifted before —
 * `describeDeathSave` and `describeDeathSaveForTranscript` — and both carried
 * DM-facing instruction text ("Narrate this; it already happened.") into
 * `transcriptLines`, which reach the browser. This function carries no
 * instruction text: the DM is already told to narrate `<engine_resolved_outcomes>`
 * facts, and the player reads the sentence as an engine line.
 *
 * Pure text in, a sentence out; no imports.
 */

/** The fields a death-save description needs; both `DeathSaveResult` (server) and `EngineDeathSave` (client) satisfy it. */
export interface DeathSaveFacts {
  roll?: number;
  isSuccess?: boolean;
  isCritical?: boolean;
  successes?: number;
  failures?: number;
  isStabilized?: boolean;
  isDead?: boolean;
  wasRevived?: boolean;
}

/**
 * One player-visible engine sentence for a rolled death saving throw. A natural 20
 * revival and a natural 1's two failures are explicit; anything else reports the
 * roll and the running tally.
 */
export function describeDeathSave(name: string, result: DeathSaveFacts): string {
  const roll = result.roll ?? 0;
  const successes = result.successes ?? 0;
  const failures = result.failures ?? 0;
  if (result.wasRevived) {
    return `${name} rolled a natural 20 on their death saving throw and is back on their feet at 1 HP.`;
  }
  if (result.isDead) {
    return `${name} rolled ${roll} on their death saving throw — the third failure. ${name} is DEAD.`;
  }
  if (result.isStabilized) {
    return `${name} rolled ${roll} on their death saving throw — the third success. ${name} is stable.`;
  }
  if (roll === 1) {
    const successWord = successes === 1 ? 'success' : 'successes';
    const failureWord = failures === 1 ? 'failure' : 'failures';
    return (
      `${name} rolled a natural 1 on their death saving throw — two failures ` +
      `(${successes} ${successWord}, ${failures} ${failureWord}).`
    );
  }
  const outcome = result.isSuccess ? 'SUCCESS' : 'FAILURE';
  const successWord = successes === 1 ? 'success' : 'successes';
  const failureWord = failures === 1 ? 'failure' : 'failures';
  return (
    `${name} rolled ${roll} on their death saving throw — ${outcome} ` +
    `(${successes} ${successWord}, ${failures} ${failureWord}).`
  );
}

/**
 * One player-visible engine sentence for damage taken at 0 HP (5e: each hit adds a
 * death-save failure, two on a critical). The DM fact and the player line are the
 * same sentence, so the DM narrates exactly what the player read.
 */
export function describeDamageAtZeroHp(
  name: string,
  failuresAdded: number,
  failures: number,
): string {
  const added =
    failuresAdded === 1
      ? 'one automatic death-save failure'
      : `${failuresAdded} automatic death-save failures`;
  const dead = failures >= 3 ? ` ${name} is DEAD.` : '';
  return `${name} takes damage at 0 HP — ${added} (${failures} of 3 failures).${dead}`;
}

/** Failure pips for a tally of three: `✕✕○`. The word beside them always carries the count. */
export function failurePips(failures: number): string {
  const filled = Math.max(0, Math.min(3, failures));
  return '✕'.repeat(filled) + '○'.repeat(3 - filled);
}

/** The facts a strike on a downed creature needs to be described. */
export interface StrikeOnDownedFacts {
  /** Failures this strike added: two for a critical, one otherwise. */
  failuresAdded: number;
  /** The failure tally after the strike. */
  failures: number;
  /** A melee blow within 5 ft: an automatic critical hit, whatever the die said. */
  automaticCritical?: boolean;
  /** A ranged blow that was a critical hit on its own natural 20. */
  critical?: boolean;
}

/**
 * One player-visible engine sentence for a hit on an unconscious creature (SRD 5.1): a melee
 * blow within 5 ft is an automatic critical hit (two failures), a ranged hit is one failure,
 * two on a critical. The DM fact and the player line are the same sentence.
 */
export function describeStrikeOnDowned(
  attacker: string,
  target: string,
  facts: StrikeOnDownedFacts,
): string {
  const count =
    facts.failuresAdded === 1
      ? 'One death-save failure'
      : `${numberWord(facts.failuresAdded)} death-save failures`;
  const how = facts.automaticCritical
    ? `${attacker} strikes the unconscious ${target} — automatic critical hit.`
    : facts.critical
      ? `${attacker} hits the unconscious ${target} from range — critical hit.`
      : `${attacker} hits the unconscious ${target} from range.`;
  const dead = facts.failures >= 3 ? ` ${target} is DEAD.` : '';
  return `${how} ${count}. ${failurePips(facts.failures)}${dead}`;
}

/** SRD 5.1 instant death: the blow's overflow past 0 HP reached the target's maximum. */
export function describeInstantDeath(
  target: string,
  facts?: { overflow?: number; hpMax?: number },
): string {
  if (facts?.overflow !== undefined && facts.hpMax !== undefined) {
    return (
      `${target} takes massive damage: ${facts.overflow} damage remains after 0 HP, and ` +
      `the hit point maximum is ${facts.hpMax}. ${target} is DEAD.`
    );
  }
  return `${target} takes massive damage — more than their hit point maximum. ${target} is DEAD.`;
}

function numberWord(value: number): string {
  return value === 2 ? 'Two' : value === 3 ? 'Three' : String(value);
}

/**
 * The line for a stable hero waking once the fight is over (SRD 5.1: 1 HP after 1d4 hours). The
 * engine rolled the hours; the DM narrates what happened while they lay there.
 */
export function describeWake(name: string, hours: number): string {
  return `${name} is stable and unconscious for ${hours} ${hours === 1 ? 'hour' : 'hours'} (1d4). ${name} wakes with 1 HP.`;
}
