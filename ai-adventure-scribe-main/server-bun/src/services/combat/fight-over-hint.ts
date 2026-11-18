/**
 * #1644: the line a player reads after the COMBAT ENDED line when the player's own action-bar kill
 * ended the fight. A typed kill and a DM-declared kill still get a DM narration, and an NPC-ended
 * fight already has the DM's turn, so they get no line.
 */
export const FIGHT_OVER_HINT = 'The fight is over. What do you do?';

/** The only end reason that gets the line. Flee, yield, a downed hero and a failed death save keep their own rows. */
const HINT_END_REASONS: ReadonlySet<string> = new Set(['last_hostile_defeated']);

type EngineRow = {
  text: string;
  context: { combatEngineBlocks: Array<{ source: string; lines: string[] }> };
};

/**
 * Adds the hint as the last line of the row, when the row is an action-bar kill of the player's
 * fight. A row that already carries the hint comes back unchanged, so a re-read never doubles it.
 */
export function applyFightOverHint<T extends EngineRow>(
  row: T,
  origin: string | undefined,
  endedReason: string | null | undefined,
): T {
  const [block] = row.context.combatEngineBlocks;
  if (!block || block.source !== 'player') return row;
  if (origin !== 'action_bar' || !HINT_END_REASONS.has(endedReason ?? '')) return row;
  if (block.lines.at(-1) === FIGHT_OVER_HINT) return row;
  return {
    ...row,
    text: [row.text, FIGHT_OVER_HINT].join('\n\n'),
    context: {
      ...row.context,
      combatEngineBlocks: [
        { ...block, lines: [...block.lines, FIGHT_OVER_HINT] },
        ...row.context.combatEngineBlocks.slice(1),
      ],
    },
  };
}
