import { describe, expect, it } from 'bun:test';

import {
  THREE_ACTOR_PLAYER_MIDDLE_NPC_BATCHES,
  TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES,
} from '../../../../../shared/test-fixtures/advance-npc-turns-rounds';
import { InitiativeMechanics } from '../initiative-mechanics.js';
import { advanceNpcTurns, type NpcTurnRunnerDependencies } from '../npc-turn-runner.js';

type TestParticipant = {
  id: string;
  name: string;
  participantType: string;
  provoked?: boolean;
  isActive: boolean;
  maxHp: number;
  actionUsed: boolean;
  monsterAttack?: unknown;
  status: {
    currentHp: number;
    isConscious: boolean;
    deathSavesSuccesses: number;
    deathSavesFailures: number;
  };
};

const weapon = {
  id: 'unarmed-strike',
  name: 'Unarmed Strike',
  damageDice: '1d1',
  damageType: 'bludgeoning',
  normalRange: 5,
  magicBonus: 0,
  finesse: false,
  ranged: false,
  proficient: true,
};

const participant = (id: string, participantType: string, currentHp = 20): TestParticipant => ({
  id,
  name: id === 'p1' ? 'The Seeker' : id,
  participantType,
  isActive: true,
  maxHp: 20,
  actionUsed: false,
  status: {
    currentHp,
    isConscious: currentHp > 0,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  },
});

function harness(
  participants: TestParticipant[],
  currentId: string,
  onIntent?: (intent: Record<string, unknown>, state: any) => unknown,
) {
  const state: any = {
    encounter: { id: 'encounter-1', sessionId: 'session-1', status: 'active' },
    participants,
    turnOrder: [],
    currentParticipant: participants.find((entry) => entry.id === currentId) ?? null,
  };
  const intents: Array<Record<string, unknown>> = [];
  const dependencies: NpcTurnRunnerDependencies = {
    getCombatState: async () => state,
    getDefaultWeapon: async () => weapon,
    executeIntent: async (_encounterId, intent) => {
      intents.push(intent as Record<string, unknown>);
      return (
        onIntent?.(intent as Record<string, unknown>, state) ?? {
          currentParticipant: state.currentParticipant,
        }
      );
    },
  };
  return { state, intents, dependencies };
}

describe('advanceNpcTurns', () => {
  it('prefers a stored scene-grounded attack over the Unarmed Strike fallback', async () => {
    const player = participant('p1', 'player');
    const npc = {
      ...participant('npc1', 'monster'),
      name: 'Chiropteran Hulk',
      monsterAttack: {
        source: 'scene',
        attacks: [
          {
            name: 'Sonic Screech',
            attackBonus: 0,
            damageDice: '4d6',
            damageBonus: 0,
            damageType: 'thunder',
            normalRange: 30,
            ranged: true,
          },
        ],
      },
    };
    const { intents, dependencies } = harness([npc, player], 'npc1');

    await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(intents[0]).toMatchObject({
      type: 'attack',
      weaponId: 'monster-attack:Sonic Screech',
    });
  });

  it('runs the NPC after a faster player turn and stops when the player is current', async () => {
    const player = participant('p1', 'player');
    const npc = participant('npc1', 'monster');
    const { state, intents, dependencies } = harness([npc, player], 'npc1', (intent, live) => {
      if (intent.type === 'attack') {
        live.currentParticipant = player;
        return { actorName: 'npc1', targetName: 'The Seeker', hit: false, d20: 4 };
      }
      return { turnAlreadyEnded: true, currentParticipant: player };
    });

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(result.iterationCount).toBe(1);
    expect(result.currentParticipant?.id).toBe('p1');
    expect(result.capReached).toBe(false);
    expect(intents.map((intent) => intent.type)).toEqual(['attack', 'end_turn']);
    expect(result.results[0]).toMatchObject({
      actorIsPlayer: false,
      action: { actor_id: 'npc1', action_type: 'attack', target_ids: ['p1'] },
    });
    expect(state.currentParticipant.id).toBe('p1');
  });

  it('does nothing when the player is already current after an NPC-faster exchange', async () => {
    const player = participant('p1', 'player');
    const npc = participant('npc1', 'monster');
    const { intents, dependencies } = harness([npc, player], 'p1');

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(result.iterationCount).toBe(0);
    expect(result.results).toEqual([]);
    expect(intents).toEqual([]);
  });

  it('ends a non-hostile NPC turn when the NPC is downed', async () => {
    const player = participant('p1', 'player');
    const npc = { ...participant('npc1', 'npc', 0), disposition: 'friendly' };
    const { state, intents, dependencies } = harness([npc, player], 'npc1', (intent, live) => {
      live.currentParticipant = player;
      return { currentParticipant: player };
    });

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(result.iterationCount).toBe(1);
    expect(intents).toEqual([{ type: 'end_turn', actorId: 'npc1' }]);
    expect(result.results[0].action.action_type).toBe('end_turn');
    expect(state.currentParticipant.id).toBe('p1');
  });

  it('keeps an unprovoked neutral NPC dodging but attacks after player damage provokes it', async () => {
    const player = participant('p1', 'player');
    const neutral = {
      ...participant('npc1', 'npc'),
      disposition: 'neutral',
    };
    const unprovoked = harness([neutral, player], 'npc1', (intent, live) => {
      live.currentParticipant = player;
      return { currentParticipant: player };
    });

    await advanceNpcTurns('encounter-1', 'user-1', unprovoked.dependencies);
    expect(unprovoked.intents).toEqual([
      { type: 'dodge', actorId: 'npc1' },
      { type: 'end_turn', actorId: 'npc1' },
    ]);

    neutral.provoked = true;
    const provoked = harness([neutral, player], 'npc1', (intent, live) => {
      live.currentParticipant = player;
      return { hit: true, finalDamage: 1, currentParticipant: player };
    });

    await advanceNpcTurns('encounter-1', 'user-1', provoked.dependencies);
    expect(provoked.intents).toEqual([
      { type: 'attack', actorId: 'npc1', targetId: 'p1', weaponId: 'unarmed-strike' },
      { type: 'end_turn', actorId: 'npc1' },
    ]);
  });

  it('skips an NPC downed mid-loop and resolves the remaining initiative', async () => {
    const first = participant('npc1', 'monster');
    const downed = participant('npc2', 'monster');
    const player = participant('p1', 'player');
    const { state, intents, dependencies } = harness(
      [first, downed, player],
      'npc1',
      (intent, live) => {
        if (intent.type === 'attack') {
          downed.status.currentHp = 0;
          downed.status.isConscious = false;
          live.currentParticipant = downed;
          return { actorName: 'npc1', targetName: 'The Seeker', hit: false };
        }
        if (intent.type === 'end_turn') {
          const next = intent.actorId === 'npc2' ? player : downed;
          live.currentParticipant = next;
          return { currentParticipant: next };
        }
        return { actorName: 'npc2', targetName: 'The Seeker', hit: true, finalDamage: 2 };
      },
    );

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(result.currentParticipant?.id).toBe('p1');
    expect(result.iterationCount).toBe(2);
    expect(intents.map((intent) => intent.type)).toEqual(['attack', 'end_turn', 'end_turn']);
    expect(result.results.map((entry) => entry.action.action_type)).toEqual(['attack', 'end_turn']);
    expect(result.results.every((entry) => entry.actorIsPlayer === false)).toBe(true);
    expect(state.currentParticipant.id).toBe('p1');
  });

  it('stops inside the loop when the engine ends combat after the NPC attack', async () => {
    const player = participant('p1', 'player');
    const npc = participant('npc1', 'monster');
    const { intents, dependencies } = harness([npc, player], 'npc1', (intent, live) => {
      live.encounter.status = 'completed';
      live.currentParticipant = null;
      return {
        combatEnded: true,
        actorName: 'npc1',
        targetName: 'The Seeker',
        hit: true,
        finalDamage: 20,
      };
    });

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(result.combatEnded).toBe(true);
    expect(result.currentParticipant).toBeNull();
    expect(intents).toHaveLength(1);
    expect(result.results[0].outcomes[0]).toMatchObject({
      participantId: 'p1',
      finalDamage: 20,
    });
  });

  it('stops when the engine ends combat after the last enemy is down', async () => {
    const player = participant('p1', 'player');
    const npc = participant('npc1', 'monster', 0);
    const { intents, dependencies } = harness([npc, player], 'npc1', (intent, live) => {
      live.encounter.status = 'completed';
      live.currentParticipant = null;
      return { combatEnded: true, currentParticipant: null };
    });

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(result.combatEnded).toBe(true);
    expect(result.iterationCount).toBe(1);
    expect(intents).toEqual([{ type: 'end_turn', actorId: 'npc1' }]);
  });

  it('includes an engine death-save line when an NPC turn reaches a downed player', async () => {
    const player = participant('p1', 'player');
    const npc = participant('npc1', 'monster');
    const { dependencies } = harness([npc, player], 'npc1', (intent, live) => {
      if (intent.type === 'attack') {
        live.currentParticipant = player;
        player.status.currentHp = 0;
        player.status.isConscious = false;
        return {
          actorName: 'npc1',
          targetName: 'The Seeker',
          hit: true,
          finalDamage: 1,
          deathSaves: [
            {
              participantId: 'p1',
              roll: 1,
              isSuccess: false,
              isCritical: false,
              successes: 0,
              failures: 2,
              isStabilized: false,
              isDead: false,
              wasRevived: false,
              newCurrentHp: 0,
            },
          ],
        };
      }
      return { turnAlreadyEnded: true, currentParticipant: player };
    });

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    const transcript = result.transcriptLines.join('\n');
    // The Engine: prefix marks this as engine fact, not DM fiction (#2457).
    expect(transcript).toContain('⚙️ Engine:');
    expect(transcript).toContain('death saving throw');
    // #2457: the transcript is player-visible, so no DM-facing instruction may leak into it,
    // and the natural 1's two failures must be explicit.
    expect(transcript).not.toContain('Narrate');
    expect(transcript).not.toContain('already happened');
    expect(transcript).toContain('two failures');
    expect(result.results[0].engineResult).toMatchObject({
      deathSaves: [{ participantId: 'p1', failures: 2 }],
    });
  });

  it('concatenates death saves from the attack and the end_turn boundary instead of dropping the first', async () => {
    const player = participant('p1', 'player');
    const npc = participant('npc1', 'monster');
    const attackSave = {
      participantId: 'p1',
      roll: 12,
      isSuccess: true,
      isCritical: false,
      successes: 1,
      failures: 0,
      isStabilized: false,
      isDead: false,
      wasRevived: false,
      newCurrentHp: 0,
    };
    const boundarySave = {
      participantId: 'p1',
      roll: 8,
      isSuccess: false,
      isCritical: false,
      successes: 1,
      failures: 1,
      isStabilized: false,
      isDead: false,
      wasRevived: false,
      newCurrentHp: 0,
    };
    const { dependencies } = harness([npc, player], 'npc1', (intent) => {
      if (intent.type === 'attack') {
        return { actorName: 'npc1', targetName: 'The Seeker', hit: true, deathSaves: [attackSave] };
      }
      if (intent.type === 'end_turn') {
        return { deathSaves: [boundarySave] };
      }
      return { currentParticipant: player };
    });

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(result.results[0].engineResult).toMatchObject({
      deathSaves: [attackSave, boundarySave],
    });
  });

  it('stops at roster size times two when the engine fails to advance the turn', async () => {
    const player = participant('p1', 'player');
    const npc = participant('npc1', 'monster');
    const { intents, dependencies } = harness([npc, player], 'npc1');

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(result.iterationCap).toBe(4);
    expect(result.iterationCount).toBe(4);
    expect(result.capReached).toBe(true);
    expect(result.currentParticipant?.id).toBe('npc1');
    expect(intents.filter((intent) => intent.type === 'attack')).toHaveLength(4);
    expect(result.transcriptLines.join('\n')).toContain('stopped after 4 iterations');
  });
});

/**
 * A fight played with the engine's own turn arithmetic: `end_turn` goes through
 * `InitiativeMechanics.calculateNextTurn`, the function `CombatInitiativeService.advanceTurn`
 * calls, so `encounter.currentRound` moves exactly as it does in production.
 */
function fight(order: Array<'player' | 'npc'>) {
  const seats = order.map((kind, index) =>
    kind === 'player' ? participant('p1', 'player') : participant(`npc${index}`, 'monster'),
  );
  const encounter = {
    id: 'encounter-1',
    sessionId: 'session-1',
    status: 'active',
    currentRound: 1,
    currentTurnOrder: 0,
  };
  const endTurn = () => {
    const next = InitiativeMechanics.calculateNextTurn(
      encounter.currentTurnOrder,
      seats.length,
      encounter.currentRound,
    );
    encounter.currentTurnOrder = next.nextTurnOrder;
    encounter.currentRound = next.newRoundNumber;
  };
  const dependencies: NpcTurnRunnerDependencies = {
    getCombatState: async () =>
      ({
        encounter: { ...encounter },
        participants: seats,
        turnOrder: [],
        currentParticipant: seats[encounter.currentTurnOrder],
      }) as never,
    getDefaultWeapon: async () => weapon,
    executeIntent: async (_encounterId, intent) => {
      if (intent.type === 'end_turn') {
        endTurn();
        return { currentParticipant: seats[encounter.currentTurnOrder] };
      }
      return { actorName: 'npc', targetName: 'The Seeker', hit: false, d20: 4 };
    },
  };
  const labels: string[] = [];
  /** The player's turn as the client labels it: the encounter round the player is acting in. */
  const playerActs = () => {
    labels.push(`ROUND ${encounter.currentRound} · PLAYER`);
    endTurn();
  };
  const npcsAct = async () => {
    const batch = await advanceNpcTurns('encounter-1', 'user-1', dependencies);
    for (const entry of batch.results) labels.push(`ROUND ${entry.round} · NPC`);
    return batch;
  };
  return { encounter, labels, playerActs, npcsAct, seats };
}

describe('advanceNpcTurns round labels (#2393)', () => {
  it.each([2, 3, 4])(
    'the engine changes the round only when the order wraps, for a %i-actor fight',
    (actors) => {
      let turnOrder = 0;
      let round = 1;
      const rounds: number[] = [];
      for (let turn = 0; turn < actors * 3; turn += 1) {
        rounds.push(round);
        const next = InitiativeMechanics.calculateNextTurn(turnOrder, actors, round);
        expect(next.newRound).toBe(next.nextTurnOrder === 0);
        turnOrder = next.nextTurnOrder;
        round = next.newRoundNumber;
      }
      expect(rounds).toEqual(
        Array.from({ length: actors * 3 }, (_, turn) => Math.floor(turn / actors) + 1),
      );
    },
  );

  it('2 actors, player first: the round changes only when the order wraps', async () => {
    const f = fight(['player', 'npc']);
    for (let turn = 0; turn < 2; turn += 1) {
      f.playerActs();
      await f.npcsAct();
    }
    expect(f.labels).toEqual([
      'ROUND 1 · PLAYER',
      'ROUND 1 · NPC',
      'ROUND 2 · PLAYER',
      'ROUND 2 · NPC',
    ]);
  });

  it('2 actors, NPC first: the round changes only when the order wraps', async () => {
    const f = fight(['npc', 'player']);
    await f.npcsAct();
    for (let turn = 0; turn < 2; turn += 1) {
      f.playerActs();
      await f.npcsAct();
    }
    expect(f.labels).toEqual([
      'ROUND 1 · NPC',
      'ROUND 1 · PLAYER',
      'ROUND 2 · NPC',
      'ROUND 2 · PLAYER',
      'ROUND 3 · NPC',
    ]);
  });

  it("3 actors, player first: both NPCs share the player's round", async () => {
    const f = fight(['player', 'npc', 'npc']);
    for (let turn = 0; turn < 2; turn += 1) {
      f.playerActs();
      await f.npcsAct();
    }
    expect(f.labels).toEqual([
      'ROUND 1 · PLAYER',
      'ROUND 1 · NPC',
      'ROUND 1 · NPC',
      'ROUND 2 · PLAYER',
      'ROUND 2 · NPC',
      'ROUND 2 · NPC',
    ]);
  });

  it('3 actors, NPC first: the NPCs before the player open the next round', async () => {
    const f = fight(['npc', 'npc', 'player']);
    await f.npcsAct();
    for (let turn = 0; turn < 2; turn += 1) {
      f.playerActs();
      await f.npcsAct();
    }
    expect(f.labels).toEqual([
      'ROUND 1 · NPC',
      'ROUND 1 · NPC',
      'ROUND 1 · PLAYER',
      'ROUND 2 · NPC',
      'ROUND 2 · NPC',
      'ROUND 2 · PLAYER',
      'ROUND 3 · NPC',
      'ROUND 3 · NPC',
    ]);
  });

  it('3 actors, player in the middle: one batch crosses the wrap and labels each side of it', async () => {
    const f = fight(['npc', 'player', 'npc']);
    await f.npcsAct();
    for (let turn = 0; turn < 2; turn += 1) {
      f.playerActs();
      await f.npcsAct();
    }
    expect(f.labels).toEqual([
      'ROUND 1 · NPC',
      'ROUND 1 · PLAYER',
      'ROUND 1 · NPC',
      'ROUND 2 · NPC',
      'ROUND 2 · PLAYER',
      'ROUND 2 · NPC',
      'ROUND 3 · NPC',
    ]);
  });

  it('returns the exact bodies the client label test feeds through the real label builder', async () => {
    const f = fight(['player', 'npc']);
    const bodies = [];
    for (let turn = 0; turn < 2; turn += 1) {
      f.playerActs();
      bodies.push(await f.npcsAct());
    }
    expect(bodies).toEqual(TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES);
    expect(f.encounter.currentRound).toBe(3);
  });

  it('returns the exact bodies for a player seated between two NPCs, one body spanning the wrap', async () => {
    const f = fight(['npc', 'player', 'npc']);
    const bodies = [await f.npcsAct()];
    for (let turn = 0; turn < 2; turn += 1) {
      f.playerActs();
      bodies.push(await f.npcsAct());
    }
    expect(bodies).toEqual(THREE_ACTOR_PLAYER_MIDDLE_NPC_BATCHES);
  });
});
