/* eslint-disable max-lines -- the pipeline test covers the ordered entry contract and telemetry. */
/**
 * #1907 PR1 — detection's placement in the turn pipeline.
 *
 * These tests are about ORDER as much as behaviour: the encounter must exist by the time the
 * generate call returns, without writing an encounter. The envelope carries a pending handoff;
 * the explicit `/enter` call owns seating and the player's initiative die.
 */
import { afterAll, describe, expect, it, spyOn } from 'bun:test';

import { logger } from '../../lib/logger.js';
import { applyCombatEntryGate } from '../combat-entry-pipeline.js';

import type { CombatEntryGateDeps } from '../combat/combat-entry-gate.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'user_01KAT5E3WFD7NGE3C0TDHX2T5G';
const COMBAT_ENTRY = {
  sessionId: SESSION_ID,
  player: { characterId: 'character-1', name: 'The Storyteller', initiativeModifier: 2 },
};

const warnings: Array<Record<string, unknown>> = [];
const warn = spyOn(logger, 'warn').mockImplementation(((entry: Record<string, unknown>) => {
  warnings.push(entry);
}) as typeof logger.warn);

afterAll(() => {
  warn.mockRestore();
});

const dmEnvelope = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    text: 'Your fist arcs toward the Ifrit.',
    combat_transition: 'none',
    scene_spec: null,
    combatants: [],
    map_actions: [],
    combat_actions: [],
    roll_requests: [],
    ...overrides,
  });

function stubDeps(): { deps: CombatEntryGateDeps; startedAt: number[] } {
  const startedAt: number[] = [];
  return {
    startedAt,
    deps: {
      getActiveEncounter: async () => undefined,
      verifySessionOwnership: async () => ({ success: true }),
      startCombat: async (_sessionId, participants) => {
        startedAt.push(participants.length);
        return {
          encounter: { id: 'encounter-1' },
          participants: participants.map((participant, index) => ({
            id: `participant-${index}`,
            name: participant.name,
            initiative: index === 0 ? 18 : 15,
            initiativeModifier: participant.initiativeModifier,
            characterId: participant.characterId ?? null,
            turnOrder: index,
          })),
          participantSizes: {},
          turnOrder: [],
          currentParticipant: null,
        };
      },
      createTacticalCombatMap: async () => ({}),
      sanitizeSceneSpec: (raw) => ({ ok: true, sceneSpec: raw as never, overrides: [] }),
      trackCombatEvent: () => {},
      persistSessionMessage: async () => undefined,
      publishCombatState: async () => undefined,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    },
  };
}

describe('applyCombatEntryGate', () => {
  it('returns a pending handoff without seating or rewriting the model transition', async () => {
    const { deps, startedAt } = stubDeps();
    const options = [
      'A. **Press the attack**, keep the Ifrit off balance.',
      'B. **Circle wide**, look for a better angle.',
    ];
    const returned = await applyCombatEntryGate({
      result: {
        text: dmEnvelope({
          options,
          roll_requests: [
            {
              type: 'attack',
              formula: '1d20+4',
              purpose: 'Punch Balthazar',
              dc: null,
              ac: null,
              advantage: false,
              disadvantage: false,
            },
          ],
        }),
      } as never,
      userId: USER_ID,
      combatEntry: COMBAT_ENTRY,
      deps,
    });

    expect(startedAt).toHaveLength(0);

    const envelope = JSON.parse(returned.text) as Record<string, unknown>;
    expect(envelope.combat_transition).toBe('none');
    expect(envelope.scene_spec).toBeNull();
    expect(envelope.options).toEqual(options);
    expect(envelope.combat_entry_pending).toMatchObject({
      trigger: 'attack_roll_request',
      combatants: [{ name: 'Hostile Creature', count: 1 }],
    });
    // Narration is never touched: the gate adds authority, it does not rewrite the fiction.
    expect(envelope.text).toBe('Your fist arcs toward the Ifrit.');
  });

  it('leaves a peaceful turn byte-identical', async () => {
    const { deps, startedAt } = stubDeps();
    const original = { text: dmEnvelope() } as never;
    const returned = await applyCombatEntryGate({
      result: original,
      userId: USER_ID,
      combatEntry: COMBAT_ENTRY,
      deps,
    });
    expect(returned).toBe(original);
    expect(startedAt).toHaveLength(0);
  });

  it('is a no-op for generations that carry no session (campaign names, extraction)', async () => {
    const { deps, startedAt } = stubDeps();
    const original = { text: dmEnvelope({ combat_transition: 'start' }) } as never;
    expect(
      await applyCombatEntryGate({ result: original, userId: USER_ID, combatEntry: null, deps }),
    ).toBe(original);
    expect(startedAt).toHaveLength(0);
  });

  it('is a no-op when the provider errored', async () => {
    const { deps, startedAt } = stubDeps();
    const original = { text: '', error: 'upstream 502' } as never;
    expect(
      await applyCombatEntryGate({
        result: original,
        userId: USER_ID,
        combatEntry: COMBAT_ENTRY,
        deps,
      }),
    ).toBe(original);
    expect(startedAt).toHaveLength(0);
  });

  it('is a no-op when the response is not a parseable envelope', async () => {
    const { deps, startedAt } = stubDeps();
    const original = { text: 'The kitchen erupts into violence.' } as never;
    expect(
      await applyCombatEntryGate({
        result: original,
        userId: USER_ID,
        combatEntry: COMBAT_ENTRY,
        deps,
      }),
    ).toBe(original);
    expect(startedAt).toHaveLength(0);
  });

  it('tolerates a fenced envelope, as the contract enforcer does', async () => {
    const { deps } = stubDeps();
    const returned = await applyCombatEntryGate({
      result: {
        text: '```json\n' + dmEnvelope({ combat_transition: 'start' }) + '\n```',
      } as never,
      userId: USER_ID,
      combatEntry: COMBAT_ENTRY,
      deps,
    });
    expect(
      (JSON.parse(returned.text) as { combat_entry_pending?: unknown }).combat_entry_pending,
    ).toBeTruthy();
  });

  it("declared attack + model already emits combat_transition:'start' with two combatants → both survive", async () => {
    const { deps } = stubDeps();
    const returned = await applyCombatEntryGate({
      result: {
        text: dmEnvelope({
          combat_transition: 'start',
          combatants: [
            { name: 'Professor Emil Darkwater', count: 1 },
            { name: 'Shadow Guard', count: 1 },
          ],
        }),
      } as never,
      userId: USER_ID,
      combatEntry: COMBAT_ENTRY,
      declaredAttack: {
        verb: 'punch',
        actorName: 'Professor Emil Darkwater',
      },
      deps,
    });

    const envelope = JSON.parse(returned.text) as Record<string, unknown>;
    expect(envelope.combat_entry_pending).toMatchObject({
      trigger: 'combat_transition',
      combatants: [
        { name: 'Professor Emil Darkwater', count: 1 },
        { name: 'Shadow Guard', count: 1 },
      ],
      declaredAttack: {
        verb: 'punch',
        actorName: 'Professor Emil Darkwater',
      },
    });
  });

  it('emits COMBAT_INTENT_DIRECTIVE_CONTRACT_VIOLATION when the model resolves the declared attack', async () => {
    warnings.length = 0;
    const { deps } = stubDeps();
    await applyCombatEntryGate({
      result: {
        text: dmEnvelope({
          text: 'Your punch hits Professor Emil Darkwater and he falls.',
        }),
      } as never,
      userId: USER_ID,
      combatEntry: COMBAT_ENTRY,
      declaredAttack: {
        verb: 'punch',
        actorName: 'Professor Emil Darkwater',
      },
      deps,
    });

    expect(warnings).toContainEqual(
      expect.objectContaining({
        msg: 'COMBAT_INTENT_DIRECTIVE_CONTRACT_VIOLATION',
        event: 'contract_violation',
        sessionId: SESSION_ID,
        actorName: 'Professor Emil Darkwater',
        verb: 'punch',
      }),
    );
  });

  it('logs the forced player-intent pending entry', async () => {
    const infos: Array<Record<string, unknown>> = [];
    const info = spyOn(logger, 'info').mockImplementation(((entry: Record<string, unknown>) => {
      infos.push(entry);
    }) as typeof logger.info);

    try {
      const { deps } = stubDeps();
      await applyCombatEntryGate({
        result: { text: 'The model leaves the attack unresolved.' } as never,
        userId: USER_ID,
        combatEntry: COMBAT_ENTRY,
        declaredAttack: {
          verb: 'punch',
          actorName: 'Professor Emil Darkwater',
        },
        deps,
      });

      expect(infos).toContainEqual(
        expect.objectContaining({
          msg: 'COMBAT_ENTRY_DETECTED_PENDING_PLAYER_ENTRY',
          trigger: 'player_intent',
        }),
      );
    } finally {
      info.mockRestore();
    }
  });
});
