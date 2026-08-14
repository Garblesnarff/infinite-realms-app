/**
 * #1779 — the deterministic combat entry gate.
 *
 * Every scenario here is drawn from prod: session 5ebaffab (four hostile turns, no encounter
 * ever created) and session 552a0122 (entry fired, but after the punch had already resolved as
 * a d20+2 skill check). The gate's contract is that each of those turns now seats an encounter
 * before the narration returns.
 */
import { describe, expect, it } from 'bun:test';

import {
  buildEntryParticipants,
  deriveEntryCombatants,
  detectCombatEntryTrigger,
  runCombatEntryGate,
  synthesizeSceneSpec,
  type CombatEntryGateDeps,
  type CombatEntryResponse,
} from '../combat-entry-gate.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'user_01KAT5E3WFD7NGE3C0TDHX2T5G';

const PLAYER = {
  characterId: 'character-1',
  name: 'The Storyteller',
  initiativeModifier: 2,
  hpCurrent: 9,
  hpMax: 9,
};

const response = (overrides: Partial<CombatEntryResponse> = {}): CombatEntryResponse => ({
  text: 'You punch the nearest living thing.',
  combat_transition: 'none',
  scene_spec: null,
  combatants: [],
  map_actions: [],
  combat_actions: [],
  roll_requests: [],
  ...overrides,
});

type Recorded = { event: string; properties: Record<string, unknown> };

function stubDeps(overrides: Partial<CombatEntryGateDeps> = {}): {
  deps: CombatEntryGateDeps;
  events: Recorded[];
  started: Array<{ sessionId: string; participants: unknown[] }>;
  maps: Array<{ sessionId: string; sceneSpec: unknown }>;
} {
  const events: Recorded[] = [];
  const started: Array<{ sessionId: string; participants: unknown[] }> = [];
  const maps: Array<{ sessionId: string; sceneSpec: unknown }> = [];
  const deps: CombatEntryGateDeps = {
    getActiveEncounter: async () => undefined,
    verifySessionOwnership: async () => ({ success: true }),
    startCombat: async (sessionId, participants) => {
      started.push({ sessionId, participants });
      return {
        encounter: { id: 'encounter-1' },
        participants: participants.map((participant, index) => ({
          id: `participant-${index}`,
          name: participant.name,
        })),
        participantSizes: {},
      };
    },
    createTacticalCombatMap: async (sessionId, _participants, sceneSpec) => {
      maps.push({ sessionId, sceneSpec });
      return {};
    },
    sanitizeSceneSpec: (raw) => ({
      ok: true,
      sceneSpec: raw as never,
      overrides: [],
    }),
    trackCombatEvent: (event, properties) => events.push({ event, properties }),
    publishCombatState: async () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
  return { deps, events, started, maps };
}

describe('detectCombatEntryTrigger — the three entry triggers', () => {
  it('trigger 1: an explicit combat_transition="start"', () => {
    expect(detectCombatEntryTrigger(response({ combat_transition: 'start' }))).toEqual({
      reason: 'combat_transition',
      detail: 'combat_transition="start"',
    });
  });

  it('trigger 2: a tactical map action against an entity (the 03:25:10 shove)', () => {
    const trigger = detectCombatEntryTrigger(
      response({
        map_actions: [
          {
            action: 'forced_move',
            target: 'dishwasher-prime',
            mode: 'shove',
            origin: null,
            distance: 5,
            destination: { x: 5, y: 5 },
          },
        ],
      }),
    );
    expect(trigger?.reason).toBe('tactical_action');
    expect(trigger?.detail).toContain('dishwasher-prime');
  });

  it('trigger 2: a declared combat_action also counts as combat behaviour', () => {
    const trigger = detectCombatEntryTrigger(
      response({
        combat_actions: [
          {
            actor_id: 'player',
            action_type: 'attack',
            target_ids: ['dishwasher-prime'],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
        ],
      }),
    );
    expect(trigger?.reason).toBe('tactical_action');
  });

  it('trigger 3: an attack-type roll_request', () => {
    const trigger = detectCombatEntryTrigger(
      response({
        roll_requests: [
          {
            type: 'attack',
            formula: '1d20+4',
            purpose: 'Punch Dishwasher Prime',
            dc: null,
            ac: 12,
            advantage: false,
            disadvantage: false,
          },
        ],
      }),
    );
    expect(trigger).toEqual({
      reason: 'attack_roll_request',
      detail: 'roll_request attack: Punch Dishwasher Prime',
    });
  });

  it('an initiative request is the same class of signal as an attack', () => {
    const trigger = detectCombatEntryTrigger(
      response({
        roll_requests: [
          {
            type: 'initiative',
            formula: '1d20+2',
            purpose: 'Roll initiative',
            dc: null,
            ac: null,
            advantage: false,
            disadvantage: false,
          },
        ],
      }),
    );
    expect(trigger?.reason).toBe('attack_roll_request');
  });

  it('a peaceful turn triggers nothing — a skill check is not combat', () => {
    expect(
      detectCombatEntryTrigger(
        response({
          roll_requests: [
            {
              type: 'check',
              formula: '1d20+3',
              purpose: 'Athletics to grapple with the apron',
              dc: 15,
              ac: null,
              advantage: false,
              disadvantage: false,
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe('deriveEntryCombatants', () => {
  it('prefers the authored combatants channel', () => {
    expect(
      deriveEntryCombatants(
        response({ combatants: [{ monster_id: 'srd:goblin', name: 'Goblin', count: 2 }] }),
        'The Storyteller',
      ),
    ).toEqual([{ name: 'Goblin', monsterId: 'srd:goblin', count: 2 }]);
  });

  it('reads the hostile out of the entity the model was shoving when combatants is empty', () => {
    expect(
      deriveEntryCombatants(
        response({
          map_actions: [
            {
              action: 'forced_move',
              target: 'dishwasher-prime',
              mode: 'shove',
              origin: null,
              distance: 5,
              destination: { x: 5, y: 5 },
            },
          ],
        }),
        'The Storyteller',
      ),
    ).toEqual([{ name: 'Dishwasher Prime', count: 1 }]);
  });

  it('never seats the player as their own enemy', () => {
    const derived = deriveEntryCombatants(
      response({
        combat_actions: [
          {
            actor_id: 'the-storyteller',
            action_type: 'attack',
            target_ids: ['the-storyteller', 'dishwasher-prime'],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
        ],
      }),
      'The Storyteller',
    );
    expect(derived.map((entry) => entry.name)).toEqual(['Dishwasher Prime']);
  });

  it('falls back to one unnamed hostile rather than refusing entry', () => {
    expect(deriveEntryCombatants(response({ combat_transition: 'start' }), 'Cleric')).toEqual([
      { name: 'Hostile Creature', count: 1 },
    ]);
  });
});

describe('synthesizeSceneSpec — scene_spec is optional (#1779 §2)', () => {
  it('produces a scene the sanitizer accepts, bound to the caller session', () => {
    const scene = synthesizeSceneSpec(SESSION_ID, 'The kitchen erupts.');
    expect(scene.sessionId).toBe(SESSION_ID);
    expect(scene.environment).toBe('dungeon_room');
    expect(scene.sceneDescription).toBe('The kitchen erupts.');
  });

  it('still produces a scene when the turn had no describable text', () => {
    expect(synthesizeSceneSpec(SESSION_ID).sceneDescription).toBeTruthy();
  });
});

describe('buildEntryParticipants', () => {
  it('seats the player first and expands counts into distinct named participants', () => {
    const participants = buildEntryParticipants(PLAYER, [
      { name: 'Goblin', monsterId: 'srd:goblin', count: 2 },
    ]);
    expect(participants.map((entry) => entry.name)).toEqual([
      'The Storyteller',
      'Goblin 1',
      'Goblin 2',
    ]);
    expect(participants[0]).toMatchObject({ characterId: 'character-1', initiativeModifier: 2 });
    expect(participants[1].monsterId).toBe('srd:goblin');
  });
});

describe('runCombatEntryGate', () => {
  it('creates the encounter and rolls initiative when a hostile signal arrives', async () => {
    const { deps, events, started } = stubDeps();
    const outcome = await runCombatEntryGate(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        response: response({ combat_transition: 'start' }),
      },
      deps,
    );

    expect(outcome?.entered).toBe(true);
    expect(outcome?.encounterId).toBe('encounter-1');
    expect(started).toHaveLength(1);
    expect(events.map((entry) => entry.event)).toEqual(['combat_started', 'initiative_completed']);
    expect(events[0].properties.entryTrigger).toBe('combat_transition');
  });

  it('does nothing when the turn carries no hostile signal', async () => {
    const { deps, started } = stubDeps();
    expect(
      await runCombatEntryGate(
        { sessionId: SESSION_ID, userId: USER_ID, player: PLAYER, response: response() },
        deps,
      ),
    ).toBeNull();
    expect(started).toHaveLength(0);
  });

  it('never restarts a fight that is already running', async () => {
    const { deps, started } = stubDeps({ getActiveEncounter: async () => ({ id: 'existing' }) });
    expect(
      await runCombatEntryGate(
        {
          sessionId: SESSION_ID,
          userId: USER_ID,
          player: PLAYER,
          response: response({ combat_transition: 'start' }),
        },
        deps,
      ),
    ).toBeNull();
    expect(started).toHaveLength(0);
  });

  it('refuses to seat an encounter in a session the caller does not own', async () => {
    const { deps, started } = stubDeps({
      verifySessionOwnership: async () => ({ success: false }),
    });
    expect(
      await runCombatEntryGate(
        {
          sessionId: SESSION_ID,
          userId: USER_ID,
          player: PLAYER,
          response: response({ combat_transition: 'start' }),
        },
        deps,
      ),
    ).toBeNull();
    expect(started).toHaveLength(0);
  });

  it('synthesizes a scene when the model supplied none', async () => {
    const { deps, maps } = stubDeps();
    const outcome = await runCombatEntryGate(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        response: response({ combat_transition: 'start', scene_spec: null }),
      },
      deps,
    );
    expect(outcome?.sceneSpecSynthesized).toBe(true);
    expect(maps).toHaveLength(1);
    expect((maps[0].sceneSpec as { environment: string }).environment).toBe('dungeon_room');
  });

  it('downgrades an invalid model scene to a synthesized one rather than aborting entry', async () => {
    const { deps, maps } = stubDeps({
      sanitizeSceneSpec: () => ({ ok: false, detail: 'sceneSpec.environment must be one of: ...' }),
    });
    const outcome = await runCombatEntryGate(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        response: response({ combat_transition: 'start', scene_spec: { environment: 'kitchen' } }),
      },
      deps,
    );
    expect(outcome?.entered).toBe(true);
    expect(outcome?.sceneSpecSynthesized).toBe(true);
    expect(maps).toHaveLength(1);
  });

  it('uses the model scene when it survives sanitising', async () => {
    const { deps, maps } = stubDeps();
    const outcome = await runCombatEntryGate(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        response: response({ combat_transition: 'start', scene_spec: { environment: 'tavern' } }),
      },
      deps,
    );
    expect(outcome?.sceneSpecSynthesized).toBe(false);
    expect((maps[0].sceneSpec as { environment: string }).environment).toBe('tavern');
  });

  it('degrades to telemetry instead of losing the turn when the encounter cannot be seated', async () => {
    const { deps, events } = stubDeps({
      startCombat: async () => {
        throw new Error('participants insert failed');
      },
    });
    const outcome = await runCombatEntryGate(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        response: response({ combat_transition: 'start' }),
      },
      deps,
    );
    expect(outcome).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('combat_entry_failed');
    expect(events[0].properties.error).toBe('participants insert failed');
  });

  /**
   * The acceptance test from the fix spec: punch a harmless named NPC with no stat block in a
   * fresh session. The DM answers with pure narration and an attack roll — no transition, no
   * scene, no combatants, exactly the shape of session 5ebaffab — and combat must still begin,
   * with the target seated (and therefore statted, via the GENERIC_NPC_STATS ladder) before
   * the turn's outcome is narrated.
   */
  it('acceptance: a punched jelly with no stat block enters combat deterministically', async () => {
    const { deps, events, started, maps } = stubDeps();
    const outcome = await runCombatEntryGate(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        response: response({
          text: "Your fist lands with a sickening squelch. Dishwasher Prime doesn't seem hurt.",
          combat_transition: 'none',
          scene_spec: null,
          combatants: [],
          roll_requests: [
            {
              type: 'attack',
              formula: '1d20+4',
              purpose: 'Unarmed strike against Dishwasher Prime',
              dc: null,
              ac: null,
              advantage: false,
              disadvantage: false,
            },
          ],
          combat_actions: [
            {
              actor_id: 'the-storyteller',
              action_type: 'attack',
              target_ids: ['dishwasher-prime'],
              weapon_id: null,
              spell_id: null,
              slot_level: null,
              movement_feet: 0,
            },
          ],
        }),
      },
      deps,
    );

    expect(outcome?.entered).toBe(true);
    expect(outcome?.trigger).toBe('tactical_action');
    expect(outcome?.sceneSpecSynthesized).toBe(true);
    // Player plus the jelly it never listed as a combatant.
    expect(started[0].participants).toHaveLength(2);
    expect((started[0].participants as Array<{ name: string }>)[1].name).toBe('Dishwasher Prime');
    expect(maps).toHaveLength(1);
    // Initiative is part of the same seating, not a later turn.
    expect(events.map((entry) => entry.event)).toEqual(['combat_started', 'initiative_completed']);
    expect(events[1].properties.participants).toBe(2);
  });
});
