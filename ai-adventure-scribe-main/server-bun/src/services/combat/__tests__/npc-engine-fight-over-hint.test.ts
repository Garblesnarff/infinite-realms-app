/**
 * #1644: when the player's own action ends the fight, the engine row says what comes next.
 *
 * The action-bar kill is engine-only: no DM turn runs after it, so the stored engine row (built by
 * `buildNpcEngineMessage`) is the last thing the player reads. The row gets one plain line after
 * the COMBAT ENDED line, in the player's block. An NPC-ended fight already has the DM's turn, and a
 * defeated party gets the death screen, so neither gets the line.
 */
import { describe, expect, it } from 'bun:test';

import { buildNpcEngineMessage } from '../../../../../shared/npc-engine-message';

const HINT = 'The fight is over. What do you do?';
const PARTICIPANTS = [
  { id: 'player-1', name: 'The Scholar', participantType: 'player' },
  { id: 'npc-1', name: 'Captain Sarah Reeves', participantType: 'npc' },
];

describe('engine row after a fight ends (#1644)', () => {
  it('adds the hint after the COMBAT ENDED line in the player block when the player ends the fight', () => {
    const message = buildNpcEngineMessage(
      PARTICIPANTS,
      2,
      { type: 'attack', actorId: 'player-1', targetId: 'npc-1' },
      { endedReason: 'last_hostile_defeated' },
    );
    expect(message.text).toBe(
      '⚙️ Engine: Combat ended — the last hostile was defeated.\n\n' + HINT,
    );
    const [block] = message.context.combatEngineBlocks;
    expect(block.source).toBe('player');
    expect(block.lines.at(-1)).toBe(HINT);
    expect(message.context.combatEnded).toBe(true);
  });

  it('adds no hint when an NPC ends the fight, because the DM turn follows', () => {
    const message = buildNpcEngineMessage(
      PARTICIPANTS,
      2,
      { type: 'attack', actorId: 'npc-1', targetId: 'player-1' },
      { endedReason: 'party_defeated' },
    );
    expect(message.text).not.toContain(HINT);
    expect(message.context.combatEngineBlocks[0].lines).not.toContain(HINT);
  });

  it('adds no hint when the party is defeated, because the death screen follows', () => {
    const message = buildNpcEngineMessage(
      PARTICIPANTS,
      2,
      { type: 'attack', actorId: 'player-1', targetId: 'npc-1' },
      { endedReason: 'party_defeated' },
    );
    expect(message.text).toContain('Combat ended — the party was defeated.');
    expect(message.text).not.toContain(HINT);
  });

  it('adds no hint to a player row that does not end the fight', () => {
    const message = buildNpcEngineMessage(
      PARTICIPANTS,
      2,
      { type: 'attack', actorId: 'player-1', targetId: 'npc-1' },
      {},
    );
    expect(message.text).not.toContain('Combat ended');
    expect(message.text).not.toContain(HINT);
    expect(message.context.combatEnded).toBeUndefined();
  });
});
