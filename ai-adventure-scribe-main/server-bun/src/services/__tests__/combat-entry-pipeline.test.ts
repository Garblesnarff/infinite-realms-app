/**
 * #1779 §1 — the gate's placement in the turn pipeline.
 *
 * These tests are about ORDER as much as behaviour: the encounter must exist by the time the
 * generate call returns, and the envelope the client receives must already say so. In session
 * 552a0122 the punch resolved at 17:39:42 and the encounter POST landed at 17:39:56 — same
 * turn, wrong order — which is what put the player a turn out of phase for the whole fight.
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
          })),
          participantSizes: {},
        };
      },
      createTacticalCombatMap: async () => ({}),
      sanitizeSceneSpec: (raw) => ({ ok: true, sceneSpec: raw as never, overrides: [] }),
      trackCombatEvent: () => {},
      publishCombatState: async () => undefined,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    },
  };
}

describe('applyCombatEntryGate', () => {
  it('seats the encounter and rewrites the envelope before the turn is returned', async () => {
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

    // The encounter exists by the time this call resolves — that is the whole ordering fix.
    expect(startedAt).toHaveLength(1);

    const envelope = JSON.parse(returned.text) as Record<string, unknown>;
    expect(envelope.combat_transition).toBe('start');
    expect(envelope.scene_spec).toBeTruthy();
    expect(envelope.options).toEqual(options);
    expect(envelope.combat_entry).toMatchObject({
      entered: true,
      encounterId: 'encounter-1',
      trigger: 'attack_roll_request',
      sceneSpecSynthesized: true,
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
    expect((JSON.parse(returned.text) as { combat_entry?: unknown }).combat_entry).toBeTruthy();
  });
});
