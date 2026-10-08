/**
 * The server's NPC drain (#2658 step 3). Migrated from the retired
 * `POST /advance-npc-turns` route tests (advance-npc-turns-http.test.ts) and the deleted client
 * continuation helper (advance-npc-turns-to-player.ts): the same contracts, now owned by
 * `runNpcTurnsIfNpcHolds` / `runNpcTurnsToPlayer`.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
// `isActive` as getCombatState always sets it: an exit (Flee) clears it.
const PLAYER = { id: 'player-1', name: 'The Seeker', participantType: 'player', isActive: true };
const NPC = { id: 'npc-holder', name: 'Goblin', participantType: 'monster', isActive: true };
const CAP_LINE =
  '⚙️ Engine: NPC turn loop stopped after 4 iterations; the encounter remains paused for safety.';

let state: {
  encounter: { id: string; sessionId: string; status: string; currentRound: number };
  currentParticipant: { id: string; participantType: string } | null;
  participants: Array<{ id: string; participantType: string; isActive: boolean }>;
};
let concludedEncounter: { endedReason: string | null } | undefined;

/** Shaped like the real AdvanceNpcTurnsResult (npc-turn-runner.ts), field for field. */
const batch = (overrides: Record<string, unknown> = {}) => ({
  results: [],
  currentParticipant: PLAYER,
  round: 2,
  combatEnded: false,
  iterationCount: 1,
  iterationCap: 4,
  capReached: false,
  transcriptLines: [],
  engineRows: [],
  ...overrides,
});
const advanceNpcTurns = mock((_encounterId: string, _userId: string) => Promise.resolve(batch()));
const writeNpcCapRow = mock((_state: unknown, line: string, _userId: string) =>
  Promise.resolve([{ id: 'cap-row', text: line }]),
);

mock.module('../../../../../db/client', () => ({ db: {} }));
mock.module('../npc-turn-runner.js', () => ({
  advanceNpcTurns: (encounterId: string, userId: string) => advanceNpcTurns(encounterId, userId),
}));
mock.module('../npc-engine-row.js', () => ({ writeNpcCapRow }));
mock.module('../combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getCombatState: async () => state,
    getLatestConcludedEncounter: async () => concludedEncounter,
  },
}));
mock.module('../session-entity-index.js', () => ({
  loadSessionEntityIndex: async () => ({
    resolve: (token: string) => (token === 'the-seeker' ? PLAYER.id : token),
  }),
}));
mock.module('../../../lib/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const { runNpcTurnsIfNpcHolds } = await import('../npc-turn-drain.js');

beforeEach(() => {
  state = {
    encounter: { id: ENCOUNTER_ID, sessionId: SESSION_ID, status: 'active', currentRound: 2 },
    currentParticipant: NPC,
    participants: [PLAYER, NPC],
  };
  concludedEncounter = undefined;
  advanceNpcTurns.mockReset();
  advanceNpcTurns.mockImplementation(() => Promise.resolve(batch()));
  writeNpcCapRow.mockClear();
});

describe('the server runs the creatures that hold the turn', () => {
  it('runs the active encounter as its owner and hands back the player', async () => {
    const drained = await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner');

    expect(advanceNpcTurns).toHaveBeenCalledWith(ENCOUNTER_ID, 'user-owner');
    expect(drained).toMatchObject({ currentParticipant: { id: 'player-1' }, iterationCount: 1 });
  });

  it('runs no loop when the player already holds the turn (another request drained it)', async () => {
    state.currentParticipant = PLAYER;

    expect(await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner')).toBeNull();
    expect(advanceNpcTurns).not.toHaveBeenCalled();
  });

  it('runs no loop once the player has left the order: nobody to hand the turn to', async () => {
    state.participants = [{ ...PLAYER, isActive: false }, NPC];

    expect(await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner')).toBeNull();
    expect(advanceNpcTurns).not.toHaveBeenCalled();
  });

  it('runs creatures before a player action only when the actor really is a player', async () => {
    expect(await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner', NPC.id)).toBeNull();
    expect(advanceNpcTurns).not.toHaveBeenCalled();

    await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner', PLAYER.id);
    expect(advanceNpcTurns).toHaveBeenCalledTimes(1);
  });

  it('resolves a slug-addressed player before deciding, as the intent route does', async () => {
    await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner', 'the-seeker');
    expect(advanceNpcTurns).toHaveBeenCalledTimes(1);

    advanceNpcTurns.mockClear();
    expect(await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner', 'goblin')).toBeNull();
    expect(advanceNpcTurns).not.toHaveBeenCalled();
  });

  it('logs a failed loop and answers null rather than failing the committed request', async () => {
    advanceNpcTurns.mockImplementation(() => Promise.reject(new Error('insert failure')));

    expect(await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner')).toBeNull();
  });
});

describe('#2517 endedReason on the drain', () => {
  it('names party_defeated when the creatures conclude the encounter in defeat', async () => {
    advanceNpcTurns.mockImplementation(() =>
      Promise.resolve(
        batch({
          currentParticipant: null,
          round: 4,
          combatEnded: true,
          transcriptLines: ['⚙️ Engine: Char is dead.'],
        }),
      ),
    );
    concludedEncounter = { endedReason: 'party_defeated' };

    const drained = await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner');

    expect(drained?.combatEnded).toBe(true);
    expect(drained?.endedReason).toBe('party_defeated');
  });

  it('has nothing to run once the encounter is concluded', async () => {
    state.encounter.status = 'completed';

    expect(await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner')).toBeNull();
    expect(advanceNpcTurns).not.toHaveBeenCalled();
  });
});

describe('the safety cap stops the run; the stranded-turn sweep resumes it', () => {
  it('runs one batch when the runner caps: no continuation, the cap line becomes a row', async () => {
    advanceNpcTurns.mockImplementation(() =>
      Promise.resolve(
        batch({
          currentParticipant: NPC,
          capReached: true,
          iterationCount: 4,
          transcriptLines: [CAP_LINE],
          engineRows: [{ id: 'row-a' }],
        }),
      ),
    );

    const drained = await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner');

    expect(advanceNpcTurns).toHaveBeenCalledTimes(1);
    expect(drained?.capReached).toBe(true);
    expect(drained?.iterationCount).toBe(4);
    expect(drained?.engineRows?.map((row) => row.id)).toEqual(['row-a', 'cap-row']);
  });

  it('writes the cap line as a row', async () => {
    advanceNpcTurns.mockImplementation(() =>
      Promise.resolve(
        batch({
          currentParticipant: NPC,
          capReached: true,
          iterationCount: 4,
          transcriptLines: [CAP_LINE],
        }),
      ),
    );

    const drained = await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner');

    expect(drained?.transcriptLines).toEqual([CAP_LINE]);
    expect(writeNpcCapRow).toHaveBeenCalledTimes(1);
    expect(writeNpcCapRow.mock.calls[0][1]).toBe(CAP_LINE);
    expect(drained?.engineRows?.map((row) => [row.id, row.text])).toEqual([['cap-row', CAP_LINE]]);
  });

  it('writes no cap row for a run that reached the player', async () => {
    await runNpcTurnsIfNpcHolds(ENCOUNTER_ID, 'user-owner');

    expect(advanceNpcTurns).toHaveBeenCalledTimes(1);
    expect(writeNpcCapRow).not.toHaveBeenCalled();
  });
});
