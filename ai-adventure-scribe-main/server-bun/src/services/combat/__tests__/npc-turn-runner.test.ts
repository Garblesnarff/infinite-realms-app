import { describe, expect, it } from 'bun:test';

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

    expect(result.transcriptLines.join('\n')).toContain('death saving throw');
    expect(result.results[0].engineResult).toMatchObject({
      deathSaves: [{ participantId: 'p1', failures: 2 }],
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
