import { describe, expect, it, mock } from 'bun:test';

// #2033 follow-up: iterationCount/iterationCap were returned in the HTTP body
// and logged nowhere, so a loop that ran once and a loop that hit the safety
// cap were indistinguishable in the log. These assert the one info line and,
// just as importantly, that it carries no narration.

let infoLines: Record<string, unknown>[] = [];
const testLogger = {
  debug: () => {},
  info: (msg: unknown) => {
    if (msg && typeof msg === 'object') infoLines.push(msg as Record<string, unknown>);
  },
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));

const { advanceNpcTurns } = await import('../npc-turn-runner.js');
type Deps = Parameters<typeof advanceNpcTurns>[2];

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

const participant = (id: string, participantType: string, currentHp = 20) => ({
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
  participants: ReturnType<typeof participant>[],
  currentId: string,
  onIntent?: (intent: Record<string, unknown>, state: any) => unknown,
) {
  const state: any = {
    encounter: { id: 'encounter-1', sessionId: 'session-1', status: 'active' },
    participants,
    turnOrder: [],
    currentParticipant: participants.find((e) => e.id === currentId) ?? null,
  };
  const dependencies = {
    getCombatState: async () => state,
    getDefaultWeapon: async () => weapon,
    executeIntent: async (_e: string, intent: Record<string, unknown>) =>
      onIntent?.(intent, state) ?? { currentParticipant: state.currentParticipant },
  } as unknown as Deps;
  return { state, dependencies };
}

const lineFrom = () => infoLines.find((l) => l.msg === 'NPC_TURN_LOOP_DONE');

describe('NPC_TURN_LOOP_DONE', () => {
  it('logs sessionId, encounterId, counts and stoppedBecause=player_turn on the ordinary handoff', async () => {
    infoLines = [];
    const player = participant('p1', 'player');
    const npc = participant('npc1', 'monster');
    const { dependencies } = harness([npc, player], 'npc1', (intent, live) => {
      if (intent.type === 'attack') {
        live.currentParticipant = player;
        return { actorName: 'npc1', targetName: 'The Seeker', hit: false, d20: 4 };
      }
      return { turnAlreadyEnded: true, currentParticipant: player };
    });

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);
    const line = lineFrom();

    expect(line).toBeDefined();
    expect(line).toMatchObject({
      msg: 'NPC_TURN_LOOP_DONE',
      sessionId: 'session-1',
      encounterId: 'encounter-1',
      iterationCount: 1,
      iterationCap: 4,
      stoppedBecause: 'player_turn',
    });
    // the log must agree with what the route returns
    expect(line?.iterationCount).toBe(result.iterationCount);
    expect(line?.iterationCap).toBe(result.iterationCap);
    // exactly one line per run
    expect(infoLines.filter((l) => l.msg === 'NPC_TURN_LOOP_DONE')).toHaveLength(1);
  });

  it('reports stoppedBecause=combat_ended when the encounter is no longer active', async () => {
    infoLines = [];
    const npc = participant('npc1', 'monster');
    const player = participant('p1', 'player');
    const { dependencies } = harness([npc, player], 'npc1', (_intent, live) => {
      live.encounter.status = 'completed';
      return { currentParticipant: live.currentParticipant };
    });

    await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    expect(lineFrom()).toMatchObject({ stoppedBecause: 'combat_ended', sessionId: 'session-1' });
  });

  it('reports stoppedBecause=cap when the loop is stopped by the safety cap', async () => {
    infoLines = [];
    // two NPCs, never handing over: cap = participants.length * 2 = 4
    const a = participant('npc1', 'monster');
    const b = participant('npc2', 'monster');
    const { dependencies } = harness([a, b], 'npc1', (_intent, live) => ({
      currentParticipant: live.currentParticipant,
    }));

    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);
    const line = lineFrom();

    expect(result.capReached).toBe(true);
    expect(line).toMatchObject({ stoppedBecause: 'cap', iterationCap: 4, iterationCount: 4 });
  });

  it('carries no narration or transcript text', async () => {
    infoLines = [];
    const player = participant('p1', 'player');
    const npc = participant('npc1', 'monster');
    const { dependencies } = harness([npc, player], 'npc1', (intent, live) => {
      if (intent.type === 'attack') {
        live.currentParticipant = player;
        return { actorName: 'npc1', targetName: 'The Seeker', hit: true, d20: 18 };
      }
      return { turnAlreadyEnded: true, currentParticipant: player };
    });

    await advanceNpcTurns('encounter-1', 'user-1', dependencies);

    const line = lineFrom();
    expect(Object.keys(line ?? {}).sort()).toEqual([
      'encounterId',
      'iterationCap',
      'iterationCount',
      'msg',
      'sessionId',
      'stoppedBecause',
    ]);
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain('The Seeker');
    expect(serialized).not.toContain('Engine:');
    expect(serialized).not.toContain('transcript');
  });
});
