import { describe, expect, it } from 'bun:test';

import { heroTurnJustEnded } from '../boss-moves.js';
import { advanceNpcTurns, type NpcTurnRunnerDependencies } from '../npc-turn-runner.js';

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

const seat = (id: string, participantType: string, turnOrder: number) => ({
  id,
  name: id,
  participantType,
  turnOrder,
  isActive: true,
  maxHp: 20,
  actionUsed: false,
  status: { currentHp: 20, isConscious: true, deathSavesSuccesses: 0, deathSavesFailures: 0 },
});

/** Initiative: hero first, then the boss. The hero's end_turn hands the turn to the boss. */
function bossFight(currentId: string) {
  const participants = [seat('hero', 'player', 0), seat('boss', 'monster', 1)];
  const state: any = {
    encounter: { id: 'encounter-1', sessionId: 'session-1', status: 'active', currentRound: 1 },
    participants,
    turnOrder: [],
    currentParticipant: participants.find((p) => p.id === currentId) ?? null,
  };
  const windowCalls: string[] = [];
  const intents: string[] = [];
  const dependencies: NpcTurnRunnerDependencies = {
    getCombatState: async () => state,
    getDefaultWeapon: async () => weapon,
    executeIntent: async (_encounterId, intent) => {
      intents.push(intent.type);
      // The boss ends its turn, and the hero is holding the turn again.
      state.currentParticipant = participants.find((p) => p.id === 'hero');
      return { currentParticipant: state.currentParticipant };
    },
    runBossMoves: async (_encounterId, _userId, seen) => {
      windowCalls.push(seen.currentParticipant?.id ?? 'none');
      return {
        lines: ['Boss Move: Starlit Lash (Opener) — misses hero'],
        engineRows: [{ id: 'row-1' } as any],
      };
    },
  };
  return { state, windowCalls, intents, dependencies };
}

describe('Boss Move window placement', () => {
  it('runs right after the hero ends their turn, before the boss acts', async () => {
    const { windowCalls, intents, dependencies } = bossFight('boss');
    const result = await advanceNpcTurns('encounter-1', 'user-1', dependencies);
    expect(windowCalls).toEqual(['boss']);
    expect(intents).toEqual(['attack', 'end_turn']);
    expect(result.engineRows?.map((row) => row.id)).toEqual(['row-1']);
  });

  it('does not run when the encounter opens on a creature with no hero before it', async () => {
    const { state, windowCalls, dependencies } = bossFight('boss');
    // Boss goes first: no hero has ended a turn yet.
    state.participants[0].turnOrder = 1;
    state.participants[1].turnOrder = 0;
    await advanceNpcTurns('encounter-1', 'user-1', dependencies);
    expect(windowCalls).toEqual([]);
  });

  it('is decided from initiative order, not from who acted last', () => {
    const { state } = bossFight('boss');
    expect(heroTurnJustEnded(state)).toBe(true);
    state.participants[0].turnOrder = 1;
    state.participants[1].turnOrder = 0;
    expect(heroTurnJustEnded(state)).toBe(false);
  });

  it('is skipped when no Boss Move dependency is wired', async () => {
    const { dependencies } = bossFight('boss');
    const { runBossMoves: _unused, ...withoutWindow } = dependencies;
    const result = await advanceNpcTurns('encounter-1', 'user-1', withoutWindow);
    expect(result.engineRows).toEqual([]);
  });
});
