/**
 * #1779 — the deterministic combat entry gate.
 *
 * Every scenario here is drawn from prod: session 5ebaffab (four hostile turns, no encounter
 * ever created) and session 552a0122 (entry fired, but after the punch had already resolved as
 * a d20+2 skill check). Detection and seating are separate contracts: the turn pipeline only
 * returns a pending handoff, while the explicit entry endpoint owns every write.
 */
import { describe, expect, it } from 'bun:test';

import {
  buildEntryParticipants,
  buildCombatSeatingTranscript,
  deriveEntryCombatants,
  detectCombatEntry,
  detectCombatEntryTrigger,
  seatCombatEntry,
  synthesizeSceneSpec,
  type CombatEntryGateDeps,
  type CombatEntryParticipantInput,
  type CombatEntryResponse,
  type CombatEntryStartResult,
} from '../combat-entry-gate.js';
import { resolveCombatIntentRefsWithRetry } from '../combat-intent-refs.js';

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
  started: Array<{ sessionId: string; participants: CombatEntryParticipantInput[] }>;
  maps: Array<{ sessionId: string; sceneSpec: unknown; seatingHint?: unknown }>;
  seatingMessages: unknown[];
} {
  const events: Recorded[] = [];
  const started: Array<{ sessionId: string; participants: CombatEntryParticipantInput[] }> = [];
  const maps: Array<{ sessionId: string; sceneSpec: unknown; seatingHint?: unknown }> = [];
  const seatingMessages: unknown[] = [];
  const deps: CombatEntryGateDeps = {
    getActiveEncounter: async () => undefined,
    verifySessionOwnership: async () => ({ success: true }),
    startCombat: async (sessionId, participants) => {
      started.push({ sessionId, participants });
      const seated = participants.map((participant, index) => ({
        id: `participant-${index}`,
        name: participant.name,
        initiative: [18, 15, 14][index] ?? 10,
        initiativeModifier: participant.initiativeModifier,
        characterId: participant.characterId ?? null,
        turnOrder: index,
      }));
      return {
        encounter: { id: 'encounter-1' },
        participants: seated,
        participantSizes: {},
        turnOrder: seated.map((participant, index) => ({
          participant: { ...participant, participantType: index === 0 ? 'player' : 'monster' },
          isCurrent: index === 0,
          hasGone: false,
        })),
        currentParticipant: seated[0] ?? null,
      } satisfies CombatEntryStartResult;
    },
    createTacticalCombatMap: async (sessionId, _participants, sceneSpec, _sizes, seatingHint) => {
      maps.push({ sessionId, sceneSpec, seatingHint });
      return {};
    },
    sanitizeSceneSpec: (raw) => ({
      ok: true,
      sceneSpec: raw as never,
      overrides: [],
    }),
    trackCombatEvent: (event, properties) => events.push({ event, properties }),
    persistSessionMessage: async (message) => seatingMessages.push(message),
    publishCombatState: async () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
  return { deps, events, started, maps, seatingMessages };
}

async function seatDetectedResponse(
  params: {
    sessionId: string;
    userId: string;
    player: typeof PLAYER;
    response: CombatEntryResponse;
    declaredAttack?: NonNullable<Parameters<typeof detectCombatEntry>[0]['declaredAttack']>;
  },
  deps: CombatEntryGateDeps,
) {
  const pending = detectCombatEntry({
    sessionId: params.sessionId,
    playerName: params.player.name,
    response: params.response,
    declaredAttack: params.declaredAttack,
    sanitizeSceneSpec: deps.sanitizeSceneSpec,
  });
  if (!pending) return null;
  return seatCombatEntry({ ...params, ...pending }, deps);
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

  describe('the PC "The Apprentice" (run M10, #2438)', () => {
    const attackOn = (...targets: string[]) => ({
      actor_id: 'the-bitter-end-mercenary',
      action_type: 'attack' as const,
      target_ids: targets,
      weapon_id: null,
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    });

    it('does not seat the player, referenced as `apprentice`, as the hostile', () => {
      const derived = deriveEntryCombatants(
        response({ combat_actions: [attackOn('apprentice', 'the-bitter-end-mercenary')] }),
        'The Apprentice',
      );
      expect(derived).toEqual([{ name: 'The Bitter End Mercenary', count: 1 }]);
    });

    it('seats one unnamed hostile when the only reference is the player', () => {
      const derived = deriveEntryCombatants(
        response({ combat_actions: [attackOn('apprentice')] }),
        'The Apprentice',
      );
      expect(derived).toEqual([{ name: 'Hostile Creature', count: 1 }]);
    });

    it('drops an authored combatant that carries the player name', () => {
      expect(
        deriveEntryCombatants(
          response({
            // The DM schema requires all three fields; an unnamed-stat creature sends `monster_id: ''`.
            combatants: [
              { monster_id: '', name: 'Apprentice', count: 1 },
              { monster_id: '', name: 'The Bitter End Mercenary', count: 1 },
            ],
          }),
          'The Apprentice',
        ),
      ).toEqual([{ name: 'The Bitter End Mercenary', monsterId: undefined, count: 1 }]);
      expect(
        deriveEntryCombatants(
          response({ combatants: [{ monster_id: '', name: 'The Apprentice', count: 1 }] }),
          'The Apprentice',
        ),
      ).toEqual([{ name: 'Hostile Creature', count: 1 }]);
    });

    it('hands the popup the mercenary, never the player', async () => {
      const { deps, started } = stubDeps();
      const player = { ...PLAYER, name: 'The Apprentice' };
      const narration =
        'You push past the shelves. The Bitter End Mercenary, a scarred sellsword, raises a blade.';
      const seated = await seatDetectedResponse(
        {
          sessionId: SESSION_ID,
          userId: USER_ID,
          player,
          response: response({
            text: narration,
            combat_transition: 'start',
            combat_actions: [attackOn('apprentice')],
          }),
        },
        deps,
      );
      expect(seated?.entered).toBe(true);
      const hostiles = started[0].participants.slice(1);
      expect(hostiles.map((participant) => participant.name)).not.toContain('Apprentice');
      expect(hostiles[0].sceneDescription).toContain('The Bitter End Mercenary');
    });
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

  it('carries prose scene identity into every hostile seat', () => {
    const participants = buildEntryParticipants(PLAYER, [{ name: 'Player 1', count: 1 }], {
      sceneDescription: 'The Chiropteran Hulk raises its blade.',
      sceneEntityName: 'Player 1',
      source: 'player_intent',
    });

    expect(participants[1]).toMatchObject({
      name: 'Player 1',
      sceneDescription: 'The Chiropteran Hulk raises its blade.',
      sceneEntityName: 'Player 1',
      source: 'player_intent',
    });
  });

  it('renders the resolved NPC name in the server-owned initiative line', () => {
    expect(
      buildCombatSeatingTranscript(
        [
          {
            id: 'player',
            name: PLAYER.name,
            initiative: 18,
            initiativeModifier: 2,
            characterId: PLAYER.characterId,
            turnOrder: 0,
          },
          {
            id: 'hulk',
            name: 'Chiropteran Hulk',
            initiative: 15,
            initiativeModifier: 0,
            participantType: 'monster',
            turnOrder: 1,
          },
        ],
        PLAYER,
        16,
      ),
    ).toContain('Chiropteran Hulk: 15 + 0 = 15.');
  });
});

describe('seating transcript display name (#2398)', () => {
  const seat = (name: string, monsterAttack: unknown, turnOrder: number) => ({
    id: `seat-${turnOrder}`,
    name,
    initiative: 12,
    initiativeModifier: 0,
    participantType: 'monster',
    turnOrder,
    monsterAttack,
  });

  it('prints the bestiary heading while the participant name stays the DM label', () => {
    const line = buildCombatSeatingTranscript(
      [
        {
          id: 'player',
          name: PLAYER.name,
          initiative: 18,
          initiativeModifier: 2,
          characterId: PLAYER.characterId,
          turnOrder: 0,
        },
        // monsterAttack as `startCombat` stores it for a bestiary creature seated under a
        // DM label: the profile jsonb with the display name set at seating.
        seat(
          'Corrupted Shard A',
          { source: 'authored', attacks: [], displayName: 'Flavor-Elemental (Corrupted) 1' },
          1,
        ),
        seat(
          'Corrupted Shard B',
          { source: 'authored', attacks: [], displayName: 'Flavor-Elemental (Corrupted) 2' },
          2,
        ),
        seat('Doorkeeper', { source: 'derived', attacks: [] }, 3),
      ],
      PLAYER,
      16,
    );
    expect(line).toContain('Flavor-Elemental (Corrupted) 1: 12 + 0 = 12.');
    expect(line).toContain('Flavor-Elemental (Corrupted) 2: 12 + 0 = 12.');
    expect(line).toContain('Doorkeeper: 12 + 0 = 12.');
    expect(line).not.toContain('Corrupted Shard');
  });
});

describe('detectCombatEntry', () => {
  it('returns a pending handoff without invoking any seating dependency', () => {
    const { deps, started, maps } = stubDeps();
    const pending = detectCombatEntry({
      sessionId: SESSION_ID,
      playerName: PLAYER.name,
      response: response({ combat_transition: 'start' }),
      sanitizeSceneSpec: deps.sanitizeSceneSpec,
    });

    expect(pending).toMatchObject({
      trigger: 'combat_transition',
      detail: 'combat_transition="start"',
      combatants: [{ name: 'Hostile Creature', count: 1 }],
      sceneSpecSynthesized: true,
    });
    expect(started).toHaveLength(0);
    expect(maps).toHaveLength(0);
  });

  it('does not detect a peaceful response', () => {
    expect(
      detectCombatEntry({
        sessionId: SESSION_ID,
        playerName: PLAYER.name,
        response: response(),
      }),
    ).toBeNull();
  });

  it('derives a seating hint when the declared target is asset-tagged in the DM turn', () => {
    const pending = detectCombatEntry({
      sessionId: SESSION_ID,
      playerName: PLAYER.name,
      response: response({
        combat_transition: 'start',
        text: '[ASSET:npc:professor-emil-darkwater] Professor Emil Darkwater says, "At last."',
        combatants: [{ monster_id: 'professor', name: 'Professor Emil Darkwater', count: 1 }],
      }),
      declaredAttack: {
        verb: 'punch',
        actorName: 'Professor Emil Darkwater',
        actorSlug: 'professor-emil-darkwater',
      },
    });

    expect(pending?.seatingHint).toEqual({
      targetName: 'Professor Emil Darkwater',
      reason: 'asset_tag',
    });
  });
});

describe('seatCombatEntry', () => {
  it('creates the encounter and rolls initiative when a hostile signal arrives', async () => {
    const { deps, events, started } = stubDeps();
    const outcome = await seatDetectedResponse(
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

  it('passes a conversation seating hint only to the matched hostile participant', async () => {
    const { deps, maps } = stubDeps();
    const outcome = await seatDetectedResponse(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        response: response({
          combat_transition: 'start',
          text: 'Professor Emil Darkwater says, "Come closer."',
          combatants: [{ monster_id: 'professor', name: 'Professor Emil Darkwater', count: 1 }],
        }),
        declaredAttack: {
          verb: 'punch',
          actorName: 'Professor Emil Darkwater',
          actorSlug: 'professor-emil-darkwater',
        },
      },
      deps,
    );

    expect(outcome?.entered).toBe(true);
    expect(maps[0]?.seatingHint).toEqual({
      targetId: 'participant-1',
      targetLabel: 'Professor Emil Darkwater',
      reason: 'conversation',
    });
  });

  it('returns the engine-derived first action for a declared punch', async () => {
    const firstAction = {
      type: 'attack' as const,
      source: 'unarmed' as const,
      attackSource: 'unarmed' as const,
      actor: 'participant-0',
      actorLabel: PLAYER.name,
      target: 'participant-1',
      targetLabel: 'Professor Emil Darkwater',
      weaponId: 'unarmed-strike',
      weaponName: 'Unarmed Strike',
      spellId: null,
      slotLevel: null,
      combat_action: {
        actor_id: 'participant-0',
        action_type: 'attack' as const,
        target_ids: ['participant-1'],
        weapon_id: 'unarmed-strike',
        spell_id: null,
        slot_level: null,
        movement_feet: 0 as const,
      },
      roll_request: {
        type: 'attack' as const,
        formula: '1d20+5',
        purpose: 'Unarmed Strike attack against Professor Emil Darkwater',
        dc: null,
        ac: 13,
        advantage: false,
        disadvantage: false,
        modifier: 5,
        actorName: PLAYER.name,
      },
    };
    const deriveFirstAction = async () => firstAction;
    const { deps } = stubDeps({ deriveFirstAction });
    const outcome = await seatCombatEntry(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        combatants: [{ name: 'Professor Emil Darkwater', count: 1 }],
        sceneSpec: synthesizeSceneSpec(SESSION_ID),
        trigger: 'player_intent',
        detail: 'player declared an attack on Professor Emil Darkwater',
        declaredAttack: { verb: 'punch', actorName: 'Professor Emil Darkwater' },
      },
      deps,
    );

    expect(outcome?.firstAction).toMatchObject({
      type: 'attack',
      source: 'unarmed',
      weaponName: 'Unarmed Strike',
      roll_request: { modifier: 5 },
    });
  });

  it('replays M4 entry through Chill Touch and resolves the immediate cast against the encounter roster', async () => {
    const order: string[] = [];
    const player = {
      characterId: 'm4-apprentice-character',
      name: 'The Apprentice',
      initiativeModifier: 1,
      hpCurrent: 7,
      hpMax: 7,
    };
    const targetName = 'Flavor-Elemental (Corrupted)';
    const { deps } = stubDeps({
      createTacticalCombatMap: async () => {
        order.push('tactical_map_saved');
      },
      deriveFirstAction: async ({ combatState }) => {
        order.push('first_action_derived');
        const [actor, target] = combatState.participants;
        return {
          type: 'spell' as const,
          actor: actor.id,
          actorLabel: player.name,
          target: target.id,
          targetLabel: targetName,
          source: 'spell' as const,
          attackSource: 'spell' as const,
          weaponId: null,
          weaponName: null,
          spellId: 'chill-touch',
          slotLevel: null,
          combat_action: {
            actor_id: actor.id,
            action_type: 'cast_spell' as const,
            target_ids: [target.id],
            weapon_id: null,
            spell_id: 'chill-touch',
            slot_level: null,
            movement_feet: 0,
          },
        };
      },
    });
    const outcome = await seatCombatEntry(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player,
        combatants: [{ name: targetName, count: 1 }],
        sceneSpec: synthesizeSceneSpec(SESSION_ID),
        trigger: 'combat_transition',
        detail: 'M4 declared Chill Touch at combat entry',
        declaredAttack: {
          verb: 'cast Chill Touch',
          actorName: targetName,
          attackSource: 'spell',
          spellName: 'Chill Touch',
          spellId: 'chill-touch',
        },
      },
      deps,
    );

    expect(order).toEqual(['tactical_map_saved', 'first_action_derived']);
    expect(outcome?.firstAction?.combat_action).toMatchObject({
      action_type: 'cast_spell',
      actor_id: 'participant-0',
      target_ids: ['participant-1'],
    });

    const immediateCast = {
      type: 'spell',
      actorId: 'the-apprentice',
      targetIds: ['flavor-elemental-corrupted'],
      spellName: 'Chill Touch',
      spellId: 'chill-touch',
    };
    const state = {
      ...outcome!.combatState,
      encounter: {
        ...outcome!.combatState.encounter,
        sessionId: SESSION_ID,
        status: 'active',
      },
    };
    const reconciliations: Record<string, unknown>[] = [];
    const { resolved } = await resolveCombatIntentRefsWithRetry(immediateCast, state, {
      loadState: async () => state,
      loadIndex: async () => ({
        resolve: (token) => (token === 'the-apprentice' ? 'm4-apprentice-character' : token),
        roster: () => 'the-apprentice, flavor-elemental-corrupted',
      }),
      warn: (event) => reconciliations.push(event),
      waitBeforeRetry: async () => undefined,
    });

    expect(resolved).toMatchObject({
      actorId: 'participant-0',
      targetIds: ['participant-1'],
    });
    expect(reconciliations).toEqual([
      expect.objectContaining({
        msg: 'COMBAT_INTENT_REF_RECONCILED_TO_ENCOUNTER_ROSTER',
        role: 'actor',
        submittedRef: 'the-apprentice',
        resolvedTo: 'participant-0',
        boardResolvedTo: 'm4-apprentice-character',
      }),
      expect.objectContaining({
        msg: 'COMBAT_INTENT_REF_RECONCILED_TO_ENCOUNTER_ROSTER',
        role: 'target',
        submittedRef: 'flavor-elemental-corrupted',
        resolvedTo: 'participant-1',
        boardResolvedTo: null,
      }),
    ]);
  });

  it('re-reads a just-seated roster once before refusing an unresolved first action', async () => {
    const fullRoster = {
      encounter: { id: 'encounter-1', sessionId: SESSION_ID, status: 'active' },
      participants: [
        { id: 'participant-player', name: 'The Apprentice' },
        { id: 'participant-target', name: 'Flavor-Elemental (Corrupted)' },
      ],
    };
    const partialRoster = {
      ...fullRoster,
      participants: [fullRoster.participants[1]],
    };
    let stateReads = 0;
    let waits = 0;
    const warnEvents: Record<string, unknown>[] = [];

    const { resolved } = await resolveCombatIntentRefsWithRetry(
      {
        type: 'spell',
        actorId: 'the-apprentice',
        targetIds: ['flavor-elemental-corrupted'],
      },
      partialRoster,
      {
        loadState: async () => {
          stateReads += 1;
          return fullRoster;
        },
        loadIndex: async () => ({
          resolve: (token) => token,
          roster: () => 'flavor-elemental-corrupted',
        }),
        warn: (event) => warnEvents.push(event),
        waitBeforeRetry: async () => {
          waits += 1;
        },
      },
    );

    expect(resolved).toMatchObject({
      actorId: 'participant-player',
      targetIds: ['participant-target'],
    });
    expect(stateReads).toBe(1);
    expect(waits).toBe(1);
    expect(warnEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ msg: 'COMBAT_INTENT_REF_RETRY_AFTER_SEATING_READ' }),
      ]),
    );
  });

  it('passes the player d20 only to the player seat and reports the complete seating line', async () => {
    const { deps, started } = stubDeps();
    const outcome = await seatCombatEntry(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        combatants: [{ name: 'Geometrist', count: 1 }],
        sceneSpec: synthesizeSceneSpec(SESSION_ID),
        playerInitiativeRoll: 16,
      },
      deps,
    );

    expect(started[0].participants[0].initiativeRoll).toBe(16);
    expect(started[0].participants[1].initiativeRoll).toBeUndefined();
    expect(outcome?.seatingTranscript).toBe(
      '⚙️ Engine: Initiative — You: 16 + 2 = 18 (you rolled). Geometrist: 15 + 0 = 15.',
    );
  });

  it('persists the seating line as a system session-message row', async () => {
    const { deps, seatingMessages } = stubDeps();
    const outcome = await seatCombatEntry(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        combatants: [{ name: 'Geometrist', count: 1 }],
        sceneSpec: synthesizeSceneSpec(SESSION_ID),
        playerInitiativeRoll: 16,
      },
      deps,
    );

    expect(seatingMessages).toEqual([
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        speakerType: 'system',
        message: outcome?.seatingTranscript,
      },
    ]);
  });

  it('labels a missing player d20 as auto-rolled', async () => {
    const { deps } = stubDeps();
    const outcome = await seatCombatEntry(
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        player: PLAYER,
        combatants: [{ name: 'Geometrist', count: 1 }],
        sceneSpec: synthesizeSceneSpec(SESSION_ID),
      },
      deps,
    );

    expect(outcome?.seatingTranscript).toContain('You: 16 + 2 = 18 (auto-rolled).');
  });

  it('does nothing when the turn carries no hostile signal', async () => {
    const { deps, started } = stubDeps();
    expect(
      await seatDetectedResponse(
        { sessionId: SESSION_ID, userId: USER_ID, player: PLAYER, response: response() },
        deps,
      ),
    ).toBeNull();
    expect(started).toHaveLength(0);
  });

  it('never restarts a fight that is already running', async () => {
    const { deps, started } = stubDeps({ getActiveEncounter: async () => ({ id: 'existing' }) });
    expect(
      await seatDetectedResponse(
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
      await seatDetectedResponse(
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
    const outcome = await seatDetectedResponse(
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
    const outcome = await seatDetectedResponse(
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
    const outcome = await seatDetectedResponse(
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

  it('records failure telemetry and propagates an entry endpoint failure', async () => {
    const { deps, events } = stubDeps({
      startCombat: async () => {
        throw new Error('participants insert failed');
      },
    });
    await expect(
      seatDetectedResponse(
        {
          sessionId: SESSION_ID,
          userId: USER_ID,
          player: PLAYER,
          response: response({ combat_transition: 'start' }),
        },
        deps,
      ),
    ).rejects.toThrow('participants insert failed');
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
    const outcome = await seatDetectedResponse(
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
