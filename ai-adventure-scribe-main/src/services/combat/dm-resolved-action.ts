/**
 * How a resolved action is worded to the DM's narration pass (#2391).
 *
 * The narration pass is handed the engine's raw result, and for a saving-throw spell that raw
 * result is written in attack vocabulary: the server sets `hit: true` for a failed save, copies
 * the save roll into `totalAttackRoll`, and reports `targetAC: 0`. Run 16 turn 7: the engine
 * line said the target FAILED its DEX save and took 2 acid damage, and the DM wrote that the
 * spell "fizzles". The player-visible engine line never reached the prompt at all.
 *
 * Each resolved action now carries `engineFact`, a sentence the DM restates, and a save spell's
 * entry loses the attack fields it never had. The engine's numbers are read, never changed.
 */
import {
  formatCombatEngineOutcome,
  type CombatEngineResult,
  type CombatTranscriptAction,
} from './combat-outcome-transcript';
import { displaySaveAbility } from './combat-spell-transcript';
import { facingName, type EngineRosterEntry } from '../../../shared/engine-display-name';

/** Sits next to `authoritativeCombatResults` whenever an entry carries an `engineFact`. */
export const ENGINE_FACT_NOTE =
  'Each engineFact is what the engine resolved. It already happened; restate it in the fiction: ' +
  'the outcome (a hit or a miss, or a saving throw passed or failed), the damage, and how the ' +
  'target is left. Never contradict it. A failed save that dealt damage is not a fizzle, a miss, ' +
  'or "no effect". A saving-throw spell has no attack roll, so it has no hit or miss: its ' +
  'target has already rolled its save, so request no roll for it. Every die for this turn is in ' +
  'these results; return no roll_requests.';

/** Fields that only describe an attack roll; a save spell never rolled one. */
const ATTACK_ONLY_FIELDS = [
  'hit',
  'd20',
  'attackBonus',
  'totalAttackRoll',
  'targetAC',
  'baseAc',
  'coverBonus',
  'cover',
  'isCritical',
  'isNaturalOne',
  'isNaturalTwenty',
] as const;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** The same test the transcript formatter uses to call an outcome a saving throw. */
const isSaveOutcome = (outcome: CombatEngineResult): boolean =>
  Boolean(outcome.saveAbility) &&
  isFiniteNumber(outcome.saveRoll) &&
  isFiniteNumber(outcome.saveDC) &&
  typeof outcome.saved === 'boolean';

const withoutAttackFields = (outcome: CombatEngineResult): Record<string, unknown> => {
  const kept: Record<string, unknown> = { ...outcome };
  for (const field of ATTACK_ONLY_FIELDS) delete kept[field];
  return kept;
};

function saveOutcomeFact(
  action: CombatTranscriptAction,
  outcome: CombatEngineResult,
  targetId: string | undefined,
  roster: readonly EngineRosterEntry[],
): string {
  const actor = facingName(outcome.actorName, action.actor_id, roster);
  const target = facingName(outcome.targetName, targetId, roster);
  const spell = outcome.spellName ?? 'a spell';
  const damage = isFiniteNumber(outcome.finalDamage) ? outcome.finalDamage : null;
  const dealt =
    damage === null ? '' : `${damage}${outcome.damageType ? ` ${outcome.damageType}` : ''} damage`;
  const verdict = outcome.saved
    ? `${target} PASSED the save and avoids the spell's effect${
        damage ? `, but still takes ${dealt}` : damage === 0 ? ': no damage' : ''
      }. The spell itself worked; ${target} simply avoided it.`
    : `${target} FAILED the save, so the spell took effect${dealt ? `: ${dealt}` : ''}.`;
  const state = outcome.targetIsDead
    ? ' and is DEAD'
    : outcome.targetIsConscious === false
      ? ' and is UNCONSCIOUS'
      : '';
  const left = isFiniteNumber(outcome.targetNewHp)
    ? ` ${target} is now at ${outcome.targetNewHp} HP${state}.`
    : '';
  return (
    `${actor} cast ${spell} at ${target}. ${spell} is a saving-throw spell: there was no attack ` +
    `roll, so there is no hit or miss. ${target} rolled a ${displaySaveAbility(outcome.saveAbility ?? '')} ` +
    `save of ${outcome.saveRoll} against DC ${outcome.saveDC}. ${verdict}${left}`
  );
}

/**
 * One `authoritativeCombatResults` entry as the DM reads it. An entry the engine printed nothing
 * for (a refusal, a bare movement) is returned as it was.
 */
export function dmFacingResolvedAction(
  entry: Record<string, unknown>,
  roster: readonly EngineRosterEntry[] = [],
): Record<string, unknown> {
  const action = entry.action as CombatTranscriptAction | undefined;
  if (!action || !isRecord(entry.engineResult)) return entry;
  const engineResult = entry.engineResult as CombatEngineResult;
  const results = Array.isArray(engineResult.results) ? engineResult.results : [engineResult];
  const isSaveSpell =
    action.action_type === 'cast_spell' && results.length > 0 && results.every(isSaveOutcome);

  if (!isSaveSpell) {
    // The transcript formatter names `target_ids[0]` for every result; each result gets its own.
    const line = Array.isArray(engineResult.results)
      ? results
          .map((result, index) =>
            formatCombatEngineOutcome(
              { ...action, target_ids: [action.target_ids?.[index] ?? ''] },
              result,
              roster,
            ),
          )
          .filter(Boolean)
          .join('\n\n')
      : formatCombatEngineOutcome(action, engineResult, roster);
    return line ? { ...entry, engineFact: line.replace(/⚙️ Engine: /g, '') } : entry;
  }
  const { autoRolled: _noPlayerDie, ...rest } = entry;
  const outcomes = Array.isArray(entry.outcomes) ? entry.outcomes : [];
  return {
    ...rest,
    engineFact: results
      .map((outcome, index) => saveOutcomeFact(action, outcome, action.target_ids?.[index], roster))
      .join(' '),
    outcomes: outcomes.map((outcome, index) => {
      const { hit: _hit, isCritical: _isCritical, ...kept } = outcome as Record<string, unknown>;
      return { ...kept, saved: results[index]?.saved === true };
    }),
    engineResult: Array.isArray(engineResult.results)
      ? { ...engineResult, results: results.map(withoutAttackFields) }
      : withoutAttackFields(engineResult),
  };
}
