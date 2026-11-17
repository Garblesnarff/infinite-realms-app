/**
 * The words a resolved mid-combat check carries: the Engine line the player reads and the DM
 * fact. Pure text, no database, so the target-number rule (#157) is testable on its own.
 */
import { DEFAULT_PARLEY_DC, type ResolvedCombatCheck } from './combat-check-rules.js';

/**
 * The one-line engine fact the DM must honour, and the Engine line the player reads.
 *
 * The narration restates this rather than inventing an outcome — the same contract #2396 gives
 * save results. A parley deliberately stops at "it holds its next action": the engine
 * records a parley, never a surrender, because a surrender is a disposition change the creature
 * stat block did not author and the DM did not grant.
 */
export function describeOutcome(params: {
  resolution: ResolvedCombatCheck;
  consequence: string;
  actorLabel: string;
  targetLabel: string | null;
  parleyDc?: number;
  showTargetNumbers: boolean;
}): { engineLine: string; dmEngineLine: string; dmFact: string } {
  const { resolution, consequence, actorLabel, targetLabel, parleyDc, showTargetNumbers } = params;
  const targetPart = targetLabel ? targetLabel : 'the room';
  // `resolution.line` already ends in the one outcome word ("— success" / "— failure"); what
  // follows is only the consequence, so the word is never said twice.
  const engineLine = resolution.success
    ? consequence
      ? `${resolution.line}, ${consequence}`
      : resolution.line
    : `${resolution.line}, nothing changes`;
  const isParley = resolution.kind === 'persuade' || resolution.kind === 'intimidate';
  // The engine line the DM restates carries the parley DC too, so it is worded without it when
  // target numbers are hidden. The player's own Engine line keeps it. The client hides the DC on
  // display (#157); this server line is the DM's input and stays as on main.
  const dmEngineLine =
    isParley && !showTargetNumbers ? engineLine.replace(` vs DC ${parleyDc}`, '') : engineLine;
  // A parley fact may only assert the stand-down on a SUCCESS. Emitting the PARLEY clause for a
  // failed roll would tell the DM the creature held its action while the engine line beside it
  // says the check failed — the fabricated-outcome shape #2396 exists to prevent.
  const parleyClause = resolution.success
    ? `PARLEY: ${targetPart} holds its next action and does not attack. It has NOT surrendered and does not drop its weapon — narrate a stand-down, not a yielding. `
    : `The ${resolution.definition.skill} check FAILED: ${targetPart} does not stand down and still attacks this round. Narrate no stand-down and no surrender. `;
  const dmFact = isParley
    ? `${actorLabel} ${resolution.definition.skill} check ${resolution.actor.total}` +
      // The DM repeats the numbers it is told, so a campaign that hides target numbers (Hard)
      // gets the fact worded without the DC, through the same shared rule the spell facts use.
      `${showTargetNumbers ? ` against DC ${parleyDc ?? DEFAULT_PARLEY_DC}` : ''}: ${resolution.success ? 'success' : 'failure'}. ${parleyClause}` +
      `Restate the engine line; never invent a surrender or a recruitment.`
    : `${actorLabel} ${resolution.definition.label}: ${engineLine}. ` +
      `Restate the engine numbers exactly; never contradict the outcome.`;
  return { engineLine, dmEngineLine, dmFact };
}
