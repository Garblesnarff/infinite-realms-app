import { describe, expect, it, mock } from 'bun:test';

import type { MapEntity, TacticalMap } from '../../../tactical/types.js';

/**
 * What the DM is told about the shape of the round.
 *
 * The board digest has always carried `ACTIVE <slug>`, so "whose turn is it" was answerable.
 * "Where does that sit in the order, and who has already spent their action" was not, and on
 * 2026-08-10 the DM declared a second attack for `the-seeker` — whose action was already spent
 * — while `sentient-glaze` held the turn. The engine refused it 422, correctly, against a
 * prompt that had never stated either fact.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SEEKER_ID = '6a470407-11a9-4c20-b7f5-fe5837ef1b44';
const GLAZE_ID = '699eb395-c30c-4dcd-9d25-e1208c780740';

const entity = (id: string, name: string, x: number): MapEntity =>
  ({
    id,
    name,
    x,
    y: 1,
    size: 'medium',
    type: 'monster',
    speedFeet: 30,
    movementRemaining: 30,
  }) as MapEntity;

let state: Record<string, unknown>;
let map: TacticalMap | null;

// `death-saves-service` reaches the db client through its import graph, which throws at module
// load without DATABASE_URL. This suite is about string assembly, not persistence.
mock.module('../../../../../db/client', () => ({ db: {} }));
mock.module('../combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getActiveEncounter: async () => (state ? { id: ENCOUNTER_ID, sessionId: SESSION_ID } : null),
    getCombatState: async () => state,
  },
}));
// The whole export surface, not just the one function used: a mocked module with a missing
// export is a hard SyntaxError for every other importer in a directory run.
mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => map,
  loadLatestTacticalMapRow: async () => ({ rowId: 'row', state: map, active: true }),
  saveTacticalMap: async () => {},
  saveTacticalMapRow: async () => {},
  deactivateTacticalMap: async () => {},
}));

const { buildTurnOrderBlock, getCurrentTurnInfo } = await import('../turn-order-block.js');
const { assignEntitySlugs } = await import('../../../tactical/identity.js');

const participant = (
  id: string,
  name: string,
  turnOrder: number,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  name,
  turnOrder,
  isActive: true,
  maxHp: 11,
  participantType: id === SEEKER_ID ? 'player' : 'monster',
  actionUsed: false,
  bonusActionUsed: false,
  status: { currentHp: 11 },
  ...overrides,
});

function board(): TacticalMap {
  const entities = [entity(SEEKER_ID, 'The Seeker', 2), entity(GLAZE_ID, 'Sentient Glaze', 8)];
  assignEntitySlugs(entities);
  return { id: 'map', sessionId: SESSION_ID, entities } as unknown as TacticalMap;
}

/** The exact 17:36 board: Seeker has acted, the order has moved on to the glaze. */
function afterSeekersTurn() {
  state = {
    encounter: { id: ENCOUNTER_ID, sessionId: SESSION_ID, currentRound: 1 },
    participants: [
      participant(SEEKER_ID, 'The Seeker', 0, { actionUsed: true }),
      participant(GLAZE_ID, 'Sentient Glaze', 1),
    ],
    currentParticipant: participant(GLAZE_ID, 'Sentient Glaze', 1),
  };
  map = board();
}

describe('the turn order block', () => {
  it('states the round, the order, and marks the current actor', async () => {
    afterSeekersTurn();
    const block = await buildTurnOrderBlock(SESSION_ID, 'user_owner');

    expect(block).toContain('<turn_order round="1">');
    expect(block).toContain('</turn_order>');
    expect(block).toContain('CURRENT TURN');
    // Marked on the glaze, and on nothing else.
    expect(block.split('\n').find((line) => line.includes('CURRENT TURN'))).toContain(
      'sentient-glaze',
    );
    expect(block.split('\n').find((line) => line.includes('the-seeker'))).not.toContain('CURRENT');
  });

  it('addresses combatants by slug — the token combat_actions must echo back', async () => {
    afterSeekersTurn();
    const block = await buildTurnOrderBlock(SESSION_ID, 'user_owner');

    expect(block).toContain('the-seeker');
    expect(block).toContain('sentient-glaze');
    // The names ride alongside so prose can be tied back, but the slug leads.
    expect(block).toContain('| The Seeker |');
    expect(block).not.toContain(SEEKER_ID);
    expect(block).not.toContain(GLAZE_ID);
  });

  it('says who has spent their action — the fact that made the 422 correct', async () => {
    afterSeekersTurn();
    const lines = (await buildTurnOrderBlock(SESSION_ID, 'user_owner')).split('\n');

    expect(lines.find((line) => line.includes('the-seeker'))).toContain('action:SPENT');
    expect(lines.find((line) => line.includes('sentient-glaze'))).toContain('action:available');
  });

  it('carries hit points, and the death-save state for anyone on the floor', async () => {
    afterSeekersTurn();
    (state.participants as Array<Record<string, unknown>>)[0] = participant(
      SEEKER_ID,
      'The Seeker',
      0,
      {
        actionUsed: true,
        status: { currentHp: 0, deathSavesSuccesses: 1, deathSavesFailures: 2 },
      },
    );
    const block = await buildTurnOrderBlock(SESSION_ID, 'user_owner');

    expect(block).toContain('11/11 HP');
    expect(block).toContain('0/11 HP');
    expect(block).toContain('UNCONSCIOUS and DYING');
    expect(block).toContain('1 death save successes, 2 failures');
  });

  it('orders by turn_order, not by the order participants happen to arrive in', async () => {
    afterSeekersTurn();
    (state.participants as unknown[]).reverse();
    const lines = (await buildTurnOrderBlock(SESSION_ID, 'user_owner'))
      .split('\n')
      .filter((line) => line.includes('|'));

    expect(lines[0]).toContain('the-seeker');
    expect(lines[1]).toContain('sentient-glaze');
    expect(lines[0]).toContain('1.');
    expect(lines[1]).toContain('2.');
  });

  it('degrades to empty rather than costing the DM the board it is appended to', async () => {
    state = undefined as unknown as Record<string, unknown>;
    map = null;
    expect(await buildTurnOrderBlock(SESSION_ID, 'user_owner')).toBe('');
  });

  it('marks roles from engine truth so the end guard can tell friend from foe (#2563)', async () => {
    afterSeekersTurn();
    (state.participants as Array<Record<string, unknown>>).push(
      participant('99999999-8888-4777-8666-555555555555', 'Mira Thane', 2, {
        participantType: 'npc',
        disposition: 'ally',
      }),
    );
    (map as { entities: unknown[] }).entities.push(
      entity('99999999-8888-4777-8666-555555555555', 'Mira Thane', 5),
    );
    assignEntitySlugs((map as { entities: MapEntity[] }).entities);
    const lines = (await buildTurnOrderBlock(SESSION_ID, 'user_owner')).split('\n');

    expect(lines.find((line) => line.includes('the-seeker'))).toContain('role:player');
    expect(lines.find((line) => line.includes('sentient-glaze'))).toContain('role:hostile');
    expect(lines.find((line) => line.includes('mira-thane'))).toContain('role:ally');
  });
});

describe('current-turn label (#2306)', () => {
  it('title-cases the slug when the roster has no name, and never returns the UUID', async () => {
    const nameless = entity(SEEKER_ID, '', 2);
    nameless.slug = 'the-scholar';
    state = {
      encounter: { id: ENCOUNTER_ID, sessionId: SESSION_ID, currentRound: 2 },
      participants: [participant(SEEKER_ID, '', 0)],
      currentParticipant: { id: SEEKER_ID },
    };
    map = { id: 'map', sessionId: SESSION_ID, entities: [nameless] } as unknown as TacticalMap;

    const turn = await getCurrentTurnInfo(SESSION_ID, 'user_owner');

    expect(turn?.label).toBe('The Scholar');
    expect(turn?.label).not.toBe(SEEKER_ID);
    expect(turn?.slug).toBe('the-scholar');
  });
});
