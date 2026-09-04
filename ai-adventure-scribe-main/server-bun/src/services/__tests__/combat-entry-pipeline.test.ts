/**
 * #1907 PR1 — detection's placement in the turn pipeline.
 *
 * These tests are about ORDER as much as behaviour: the encounter must exist by the time the
 * generate call returns, without writing an encounter. The envelope carries a pending handoff;
 * the explicit `/enter` call owns seating and the player's initiative die.
 */
import { describe, expect, it } from 'bun:test';

import { applyCombatEntryGate } from '../combat-entry-pipeline.js';

import type { CombatEntryGateDeps } from '../combat/combat-entry-gate.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'user_01KAT5E3WFD7NGE3C0TDHX2T5G';
const COMBAT_ENTRY = {
  sessionId: SESSION_ID,
  player: { characterId: 'character-1', name: 'The Storyteller', initiativeModifier: 2 },
};

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
});
