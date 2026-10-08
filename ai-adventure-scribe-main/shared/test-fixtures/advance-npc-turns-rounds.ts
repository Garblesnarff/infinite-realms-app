/**
 * The server's NPC-turn results of two fights (#2393): `npcTurns` on the End turn response.
 *
 * Shared on purpose. The client labels every engine line `ROUND n · PLAYER|NPC`, and for the NPC
 * half it reads `n` from these bodies. It used to guess it, because they carried no round, and
 * the guess added one after every player turn: ROUND 1 · PLAYER, ROUND 2 · NPC, ROUND 2 · PLAYER,
 * ROUND 3 · NPC. The server test asserts the real runner produces exactly these bodies, walking
 * the order with the engine's own `calculateNextTurn`; the client test feeds these same bodies
 * through the real label builder.
 */

export const ROUND_FIGHT_PLAYER_ID = 'p1';
export const ROUND_FIGHT_PLAYER_NAME = 'The Seeker';

const npcBatch = (
  actors: number,
  acted: Array<{ npcId: string; round: number }>,
  nextTurnRound: number,
) => ({
  results: acted.map(({ npcId, round }) => ({
    action: {
      actor_id: npcId,
      action_type: 'attack' as const,
      target_ids: [ROUND_FIGHT_PLAYER_ID],
      weapon_id: 'unarmed-strike',
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    },
    round,
    outcomes: [{ participantId: ROUND_FIGHT_PLAYER_ID, hit: false }],
    engineResult: { actorName: 'npc', targetName: ROUND_FIGHT_PLAYER_NAME, hit: false, d20: 4 },
    actorIsPlayer: false as const,
    transcriptLines: [] as string[],
  })),
  currentParticipant: {
    id: ROUND_FIGHT_PLAYER_ID,
    name: ROUND_FIGHT_PLAYER_NAME,
    participantType: 'player',
  },
  round: nextTurnRound,
  combatEnded: false,
  iterationCount: acted.length,
  // The runner's safety cap is twice the roster size.
  iterationCap: actors * 2,
  capReached: false,
  transcriptLines: [] as string[],
  engineRows: [],
});

/**
 * Initiative order: player, `npc1`. One body per player turn. `npc1` is last in the order, so its
 * turn ends the round and the player's next turn is one on.
 */
export const TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES = [
  npcBatch(2, [{ npcId: 'npc1', round: 1 }], 2),
  npcBatch(2, [{ npcId: 'npc1', round: 2 }], 3),
];

/**
 * Initiative order: `npc0`, player, `npc2`. The first body is the pre-flight before the player's
 * first turn. Each later one is what follows a player turn: `npc2` finishes the round, the order
 * wraps, and `npc0` opens the next one, so a single body carries two rounds.
 */
export const THREE_ACTOR_PLAYER_MIDDLE_NPC_BATCHES = [
  npcBatch(3, [{ npcId: 'npc0', round: 1 }], 1),
  npcBatch(
    3,
    [
      { npcId: 'npc2', round: 1 },
      { npcId: 'npc0', round: 2 },
    ],
    2,
  ),
  npcBatch(
    3,
    [
      { npcId: 'npc2', round: 2 },
      { npcId: 'npc0', round: 3 },
    ],
    3,
  ),
];
