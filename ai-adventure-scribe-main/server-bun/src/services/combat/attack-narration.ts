/**
 * What the engine did to whom, in the words the DM narrates from.
 *
 * Its own module, with no imports at all, because it is a pure sentence and its callers are
 * not. `combat-approach-service` pulls in the combat logger, which pulls in the shared pino
 * instance — enough of a graph that a test wanting to assert on this one string could not
 * import it without the whole chain, and in the server suite that chain is poisoned by a
 * process-wide `mock.module` leak from an unrelated file. A string builder with no
 * dependencies is testable from anywhere, which is the point.
 */
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
    isCritical?: boolean;
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
  const crit = outcome.isCritical ? 'CRITICAL HIT' : 'HIT';
  const damage = Number(outcome.finalDamage ?? 0);
  const hp =
    outcome.targetNewHp == null ? '' : ` ${targetLabel} is now at ${outcome.targetNewHp} HP`;
  const state = outcome.targetIsDead
    ? ` and is DEAD`
    : outcome.targetIsConscious === false
      ? ` and is UNCONSCIOUS`
      : '';
  return (
    `${actorLabel} attacked ${targetLabel}${weapon}: ${crit}${auto} for ${damage} damage.${hp}${state}. ` +
    'Narrate this outcome; it already happened.'
  );
}
