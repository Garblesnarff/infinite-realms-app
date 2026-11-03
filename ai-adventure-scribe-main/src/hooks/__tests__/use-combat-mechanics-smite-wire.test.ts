/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1362 (AGENTS.md §4): the Divine Smite the action bar sends must be the exact body the real
 * intent route accepts. This drives the real hook and the real executor; only the HTTP call is
 * stubbed, so the POST body is what the client actually posts.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn() }));

vi.mock('@/infrastructure/api/rest-client', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  fetchWithAuth,
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/classFeatures', () => ({
  getRageDamageBonus: vi.fn(),
  canUseClassFeature: vi.fn(),
}));

vi.mock('@/utils/combat/deathSaves', () => ({
  needsDeathSaves: vi.fn(),
  rollDeathSave: vi.fn(),
}));

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
  rollAttack: vi.fn(),
}));

vi.mock('@/utils/equipmentUtils', () => ({
  createDefaultLightWeapons: vi.fn(),
  equipMainHandWeapon: vi.fn(),
  equipOffHandWeapon: vi.fn(),
}));

vi.mock('@/utils/character-calculations', () => ({
  calculateProficiencyBonus: vi.fn(),
}));

vi.mock('@/utils/racialTraits', () => ({
  canUseRacialTrait: vi.fn(),
}));

vi.mock('@/utils/twoWeaponFighting', () => ({
  canUseTwoWeaponFighting: vi.fn(),
  makeMainHandAttack: vi.fn(),
  canMakeOffHandAttack: vi.fn(),
  makeOffHandAttack: vi.fn(),
}));

import {
  DIVINE_SMITE_ACTOR_ID,
  DIVINE_SMITE_TARGET_ID,
  divineSmiteAttackBody,
} from '../../../shared/test-fixtures/divine-smite-attack-intent';
import { useCombatMechanics } from '../use-combat-mechanics';

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Divine Smite action bar wire body (#1362)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchWithAuth.mockImplementation(async (url: string) =>
      url.endsWith('/status')
        ? jsonResponse({ encounter: { version: 7 } })
        : jsonResponse({ applied: true }),
    );
  });

  it('posts exactly the shared Smite attack body to the intent route', async () => {
    const encounter: any = {
      id: 'enc-1',
      participants: [
        {
          id: DIVINE_SMITE_ACTOR_ID,
          name: 'Paladin',
          participantType: 'player',
          characterClass: 'paladin',
        },
        { id: DIVINE_SMITE_TARGET_ID, name: 'Orc', participantType: 'npc' },
      ],
    };
    const { result } = renderHook(() =>
      useCombatMechanics({
        activeEncounter: encounter,
        handleCombatAction: vi.fn(),
        takeAction: vi.fn(),
        updateParticipant: vi.fn(),
        selectedEnemy: DIVINE_SMITE_TARGET_ID,
      } as any),
    );

    await act(async () => {
      await result.current.handleEnhancedAttack(
        DIVINE_SMITE_ACTOR_ID,
        DIVINE_SMITE_TARGET_ID,
        'divine_smite',
        false,
        false,
        1,
      );
    });

    const intentCall = fetchWithAuth.mock.calls.find(([url]) =>
      String(url).endsWith('/v1/combat/enc-1/intent'),
    );
    expect(intentCall).toBeDefined();
    expect(JSON.parse(String(intentCall?.[1]?.body))).toEqual(divineSmiteAttackBody(7));
  });
});
