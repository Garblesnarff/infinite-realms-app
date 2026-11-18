/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #621 B2b, AGENTS.md §4, client half: the JSON the executor actually posts equals the shared wire
 * fixture for each routed body.
 *
 * The real `executeAuthoritativeCombatIntent` runs. Only the network function is mocked, and it
 * records every request. Player-sourced bodies first read the encounter version from `/status`,
 * so the mock answers that with the fixture's version. The posted body is then compared with the
 * wire fixture: intent (with `expectedVersion`), source and origin. `dmStartedAt` is a clock
 * reading and is left out of the comparison.
 */
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  actionSurgeClientIntent,
  B2B_ENCOUNTER_ID,
  B2B_ENCOUNTER_VERSION,
  B2B_ENEMY_ID,
  B2B_PLAYER_ID,
  dashClientIntent,
  divineSenseClientIntent,
  dodgeClientIntent,
  enemyAttackWireBody,
  featureWireBody,
  grappleClientIntent,
  hideClientIntent,
  playerActionWireBody,
  secondWindClientIntent,
  shoveClientIntent,
} from '../../../../shared/test-fixtures/combat-b2b-intent-bodies';
import { useCombatMechanics } from '../../use-combat-mechanics';
import { useCombatActionHandlers } from '../use-combat-action-handlers';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';

vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

type Posted = { url: string; body: Record<string, unknown> };
let posted: Posted[] = [];

const json = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** The body the executor posted last, with the clock reading removed. */
const lastPostedWithoutClock = (): Record<string, unknown> => {
  const { dmStartedAt: _clock, ...rest } = posted[posted.length - 1].body;
  return rest;
};

const b2bEncounter = {
  id: B2B_ENCOUNTER_ID,
  participants: [
    { id: B2B_PLAYER_ID, name: 'Hero', conditions: [], level: 5 },
    { id: B2B_ENEMY_ID, name: 'Orc', conditions: [] },
  ],
  currentTurnParticipantId: B2B_PLAYER_ID,
};

const renderActions = () =>
  renderHook(() =>
    useCombatActionHandlers({
      activeEncounter: b2bEncounter as any,
      nextTurn: vi.fn().mockResolvedValue(undefined),
      selectedEnemy: B2B_ENEMY_ID,
    }),
  );

const renderMechanics = (classFeatures: Array<{ name: string }>) =>
  renderHook(() =>
    useCombatMechanics({
      activeEncounter: {
        id: B2B_ENCOUNTER_ID,
        participants: [
          {
            id: B2B_PLAYER_ID,
            name: 'Fighter',
            level: 5,
            conditions: [],
            classFeatures: classFeatures.map((feature) => ({
              ...feature,
              maxUses: 1,
              currentUses: 1,
            })),
            resources: {},
          },
        ],
        currentTurnParticipantId: B2B_PLAYER_ID,
      } as any,
    }),
  );

beforeEach(() => {
  posted = [];
  vi.mocked(fetchWithAuth).mockReset();
  vi.mocked(fetchWithAuth).mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/status')) {
      return json({ encounter: { version: B2B_ENCOUNTER_VERSION } });
    }
    posted.push({ url, body: JSON.parse(String(init?.body)) });
    return json({ accepted: true });
  });
});

describe('#621 B2b: the executor posts the wire fixtures', () => {
  it('enemy attack posts the DM-source wire body', async () => {
    const { result } = renderActions();
    await act(async () => {
      await result.current.handleEnemyAttack({
        name: 'Greataxe',
        attackBonus: 5,
        damageRoll: '1d12+3',
        damageType: 'slashing',
        reach: 5,
        description: 'Greataxe',
      } as any);
    });

    expect(posted[0].url).toBe(`/v1/combat/${B2B_ENCOUNTER_ID}/intent`);
    expect(lastPostedWithoutClock()).toEqual(enemyAttackWireBody);
  });

  it.each([
    ['dash', 'dash', dashClientIntent],
    ['dodge', 'dodge', dodgeClientIntent],
    ['hide', 'hide', hideClientIntent],
  ])('%s posts the player wire body with the version it read', async (_name, action, intent) => {
    const { result } = renderActions();
    await act(async () => {
      await result.current.handleCombatAction(action as any, B2B_PLAYER_ID);
    });

    expect(lastPostedWithoutClock()).toEqual(playerActionWireBody(intent));
  });

  it.each([
    ['grapple', 'grapple', grappleClientIntent],
    ['shove', 'shove', shoveClientIntent],
  ])('%s against the target posts the player check wire body', async (_name, action, intent) => {
    const { result } = renderActions();
    await act(async () => {
      await result.current.handleCombatAction(action as any, B2B_PLAYER_ID, B2B_ENEMY_ID);
    });

    expect(lastPostedWithoutClock()).toEqual(playerActionWireBody(intent));
  });

  it.each([
    ['second_wind', secondWindClientIntent],
    ['action_surge', actionSurgeClientIntent],
    ['divine_sense', divineSenseClientIntent],
  ])('%s posts the DM-panel wire body', async (feature, intent) => {
    const { result } = renderMechanics([{ name: feature }]);
    await act(async () => {
      await result.current.handleClassFeature(B2B_PLAYER_ID, feature);
    });

    expect(lastPostedWithoutClock()).toEqual(featureWireBody(intent));
  });
});
