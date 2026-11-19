/**
 * #1644: an action-bar kill that ends the fight gets one plain line after the COMBAT ENDED line.
 *
 * The action-bar kill is engine-only: no DM turn runs after it, so the stored engine row is the last
 * thing the player reads. A typed or DM-declared kill still gets a DM narration. An NPC-ended fight
 * already has the DM's turn. Flee, yield, a downed hero and a failed death save keep their own rows.
 */
import { describe, expect, it } from 'bun:test';

import { buildNpcEngineMessage } from '../../../../../shared/npc-engine-message';
import { applyFightOverHint, FIGHT_OVER_HINT } from '../fight-over-hint';

const PARTICIPANTS = [
  { id: 'player-1', name: 'The Scholar', participantType: 'player' },
  { id: 'npc-1', name: 'Captain Sarah Reeves', participantType: 'npc' },
];

/** The row the server writes: the builder, then the hint step the writer applies. */
function rowFor(
  intentType: string,
  actorId: string,
  origin: string | undefined,
  endedReason: string | null,
) {
  const built = buildNpcEngineMessage(
    PARTICIPANTS,
    2,
    { type: intentType, actorId, targetId: 'npc-1' },
    endedReason ? { endedReason } : {},
  );
  return applyFightOverHint(built, origin, endedReason);
}

const countHints = (text: string) => text.split(FIGHT_OVER_HINT).length - 1;

describe('action-bar kill that ends the fight (#1644)', () => {
  it('adds exactly one hint after the COMBAT ENDED line, in the player block', () => {
    const row = rowFor('attack', 'player-1', 'action_bar', 'last_hostile_defeated');
    expect(row.text).toBe(
      '⚙️ Engine: Combat ended — the last hostile was defeated.\n\n' + FIGHT_OVER_HINT,
    );
    const [block] = row.context.combatEngineBlocks;
    expect(block.source).toBe('player');
    expect(block.lines.at(-1)).toBe(FIGHT_OVER_HINT);
    expect(countHints(row.text)).toBe(1);
  });

  it('still has exactly one hint after the row is stored and read back', () => {
    const row = rowFor('attack', 'player-1', 'action_bar', 'last_hostile_defeated');
    // The stored row is jsonb: the context and text come back as parsed JSON.
    const stored = JSON.parse(JSON.stringify({ text: row.text, context: row.context }));
    expect(countHints(stored.text)).toBe(1);
    expect(
      stored.context.combatEngineBlocks[0].lines.filter((l: string) => l === FIGHT_OVER_HINT),
    ).toHaveLength(1);
    // A second pass over the read-back row (a re-read or a replay) does not add another.
    const reapplied = applyFightOverHint(stored, 'action_bar', 'last_hostile_defeated');
    expect(countHints(reapplied.text)).toBe(1);
  });
});

describe('no hint where a DM turn follows or the fight did not end on a kill (#1644)', () => {
  it('typed kill gets no hint, because the DM narrates it', () => {
    const row = rowFor('attack', 'player-1', 'typed', 'last_hostile_defeated');
    expect(row.text).not.toContain(FIGHT_OVER_HINT);
  });

  it('DM-declared kill gets no hint', () => {
    const row = rowFor('attack', 'player-1', 'dm', 'last_hostile_defeated');
    expect(row.text).not.toContain(FIGHT_OVER_HINT);
  });

  it('action-bar flee gets no hint', () => {
    const row = rowFor('flee', 'player-1', 'action_bar', 'abandoned');
    expect(row.text).not.toContain(FIGHT_OVER_HINT);
  });

  it('action-bar yield gets no hint', () => {
    const row = rowFor('yield', 'player-1', 'action_bar', 'player_surrendered');
    expect(row.text).not.toContain(FIGHT_OVER_HINT);
  });

  it('a death save that fails the hero gets no hint', () => {
    const row = rowFor('death_save', 'player-1', 'action_bar', 'death_save_failed');
    expect(row.text).not.toContain(FIGHT_OVER_HINT);
  });

  it('a hero who is down and stable gets no hint', () => {
    const row = rowFor('end_turn', 'player-1', 'action_bar', 'player_down_stable');
    expect(row.text).not.toContain(FIGHT_OVER_HINT);
  });

  it('an NPC kill gets no hint, because the DM turn follows', () => {
    const row = rowFor('attack', 'npc-1', 'action_bar', 'last_hostile_defeated');
    expect(row.text).not.toContain(FIGHT_OVER_HINT);
  });

  it('a party defeat gets no hint, because the death screen follows', () => {
    const row = rowFor('attack', 'player-1', 'action_bar', 'party_defeated');
    expect(row.text).not.toContain(FIGHT_OVER_HINT);
  });

  it('a player action that does not end the fight gets no hint', () => {
    const row = rowFor('attack', 'player-1', 'action_bar', null);
    expect(row.text).not.toContain(FIGHT_OVER_HINT);
  });
});
