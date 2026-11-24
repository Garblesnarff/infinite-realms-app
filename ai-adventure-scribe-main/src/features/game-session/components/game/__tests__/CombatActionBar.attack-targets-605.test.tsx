/* eslint-disable max-lines */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CombatActionBarLive } from '../CombatActionBar';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { askPlayerForAttackDie } from '@/services/combat/player-attack-roll';

const pcWire = {
  position: { x: 1, y: 1, sceneId: 'scene-1' },
  id: 'pc-1',
  characterId: 'char-pc-1',
  name: 'Veteran',
  participantType: 'player',
  initiative: 15,
  initiativeModifier: 0,
  turnOrder: 0,
  isActive: true,
  armorClass: 15,
  maxHp: 20,
  speed: 30,
  actionUsed: false,
  bonusActionUsed: false,
  reactionUsed: false,
  status: {
    currentHp: 20,
    maxHp: 20,
    tempHp: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  },
  vitalState: 'standing',
  conditions: [],
  monsterAttack: null,
};

const slug = (
  id: string,
  name: string,
  hp: number,
  maxHp: number,
  turnOrder: number,
): Record<string, unknown> => ({
  position: { x: 2, y: 2, sceneId: 'scene-1' },
  id,
  characterId: null,
  name,
  participantType: 'monster',
  initiative: 10,
  initiativeModifier: 0,
  turnOrder,
  isActive: true,
  armorClass: 12,
  maxHp,
  speed: 30,
  actionUsed: false,
  bonusActionUsed: false,
  reactionUsed: false,
  status: {
    currentHp: hp,
    maxHp,
    tempHp: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  },
  vitalState: 'standing',
  conditions: [],
  monsterAttack: null,
});

const buildEncounter = (): ReturnType<typeof mapAuthoritativeCombat> =>
  mapAuthoritativeCombat({
    encounter: {
      id: 'enc-1',
      sessionId: 'sess-1',
      status: 'active',
      currentRound: 1,
      currentTurnOrder: 0,
      startedAt: '2026-10-05T23:43:11.584Z',
    },
    participants: [
      pcWire,
      slug('slug-1', 'Slug-Thing 1', 3, 9, 1),
      slug('slug-2', 'Slug-Thing 2', 9, 9, 2),
      slug('slug-3', 'Slug-Thing 3', 9, 9, 3),
    ],
  } as never);

// Producer: server-bun/src/services/combat/combat-intent-service.ts getLegalCombatActions -> buildCombatWeaponOptions in server-bun/src/services/combat/combat-weapon-options.ts
// (getLegalCombatActions also always emits Dash/Dodge/Disengage; weaponId is the equipment row id there).
const legalPayload = {
  encounterId: 'enc-1',
  version: 1,
  actorId: 'pc-1',
  actions: [
    {
      type: 'attack',
      label: 'Attack with Crossbow, light',
      weaponId: 'crossbow-light',
      targetIds: ['slug-1', 'slug-2', 'slug-3'],
    },
    {
      type: 'attack',
      label: 'Attack with Longsword',
      weaponId: 'longsword',
      targetIds: ['slug-1', 'slug-2', 'slug-3'],
    },
    { type: 'dash', label: 'Dash' },
    { type: 'dodge', label: 'Dodge' },
    { type: 'disengage', label: 'Disengage' },
    { type: 'end_turn', label: 'End turn' },
  ],
};

let currentLegalPayload = legalPayload;

const combatHolder = vi.hoisted(() => ({
  current: undefined as
    | {
        state: { isInCombat: boolean; activeEncounter: ReturnType<typeof buildEncounter> | null };
        refreshCombatState: () => void;
      }
    | undefined,
}));
const pack = vi.hoisted(() => ({
  inventory: [] as Array<{ id: string; name: string }>,
  cantrips: [] as Array<Record<string, unknown>>,
  known: [] as Array<Record<string, unknown>>,
  spellcasting: null as Record<string, unknown> | null,
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => combatHolder.current,
  useOptionalCombat: () => combatHolder.current,
}));
vi.mock('../overhaul/useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    character: {
      spells: { cantrips: pack.cantrips, known: pack.known, prepared: [] },
      spellcasting: pack.spellcasting,
      inventory: pack.inventory,
      attacks: [
        { id: 'crossbow-light', name: 'Crossbow, light', bonus: '+4', damage: '1d8' },
        { id: 'longsword', name: 'Longsword', bonus: '+5', damage: '1d8+3' },
      ],
    },
  }),
}));
vi.mock('../../tactical/TacticalMapProvider', () => ({ useTacticalMapContext: () => null }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({})),
  isSessionEnded: vi.fn(() => false),
  loadCachedSession: vi.fn(() => null),
  markSessionEnded: vi.fn(),
  persistSession: vi.fn(),
  refreshAccessTokenOnce: vi.fn(),
  SESSION_ENDED_MESSAGE: 'Your sign-in expired — sign in again; your game is saved',
  TokenRefreshTransportError: class TokenRefreshTransportError extends Error {},
}));
vi.mock('@/services/combat/player-attack-roll', () => ({ askPlayerForAttackDie: vi.fn() }));

// Real combat-action-executor intentionally NOT mocked: it builds the posted request.

const recorded: Array<{ url: string; method: string; body: unknown }> = [];

const defaultProps = {
  turnInFlight: false,
  onSendMessage: vi.fn().mockResolvedValue(undefined),
  onSendText: vi.fn().mockResolvedValue(undefined),
  onMove: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  recorded.length = 0;
  currentLegalPayload = legalPayload;
  combatHolder.current = undefined;
  pack.inventory = [];
  pack.cantrips = [];
  pack.known = [];
  pack.spellcasting = null;
  vi.clearAllMocks();
  vi.mocked(askPlayerForAttackDie).mockResolvedValue({
    d20: 14,
    d20Rolls: [14, 14],
    autoRolled: false,
    movementOnly: false,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
      const method = (init?.method ?? 'GET').toUpperCase();
      let body: unknown = null;
      if (init?.body && typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      recorded.push({ url, method, body });
      if (url.includes('/legal-actions'))
        return { ok: true, status: 200, json: async () => currentLegalPayload } as Response;
      if (url.includes('/tactical-map'))
        return {
          ok: true,
          status: 200,
          json: async () => ({ entities: [{ id: 'pc-1', movementRemaining: 5 }] }),
        } as Response;
      return { ok: true, status: 200, json: async () => ({ result: {} }) } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CombatActionBar attack targets (#605)', () => {
  it('lists 6 weapon→slug items in the dropdown', async () => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter() },
      refreshCombatState: vi.fn(),
    };
    render(<CombatActionBarLive {...defaultProps} />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const trigger = await screen.findByRole('button', { name: /Other weapons and targets/i });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    await user.click(trigger);
    const items = await screen.findAllByRole('menuitem');
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.textContent)).toEqual([
      'Attack with Crossbow, light → Slug-Thing 1',
      'Attack with Crossbow, light → Slug-Thing 2',
      'Attack with Crossbow, light → Slug-Thing 3',
      'Attack with Longsword → Slug-Thing 1',
      'Attack with Longsword → Slug-Thing 2',
      'Attack with Longsword → Slug-Thing 3',
    ]);
  });

  it('replaces same-turn melee options when the board moves out of reach (#1642)', async () => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter() },
      refreshCombatState: vi.fn(),
    };
    render(<CombatActionBarLive {...defaultProps} />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const trigger = await screen.findByRole('button', { name: /Other weapons and targets/i });
    await waitFor(() => expect(trigger).not.toBeDisabled());

    currentLegalPayload = {
      ...legalPayload,
      actions: [
        legalPayload.actions[0]!,
        {
          type: 'attack',
          weaponId: 'javelin',
          label: 'Attack with Javelin',
          targetIds: ['slug-1'],
        },
      ],
    };
    act(() => {
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', {
          detail: { type: 'entity_moved', entityId: 'pc-1', movementRemaining: 10 },
        }),
      );
    });
    await waitFor(() =>
      expect(recorded.filter(({ url }) => url.includes('/legal-actions'))).toHaveLength(2),
    );
    await waitFor(() => expect(trigger).not.toBeDisabled());
    await user.click(trigger);
    expect(
      await screen.findByRole('menuitem', { name: 'Attack with Javelin → Slug-Thing 1' }),
    ).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: /Longsword/ })).toBeNull();
  });

  it.each([
    ['crossbow-light', 'Attack with Crossbow, light', 'slug-1', 'Slug-Thing 1'],
    ['crossbow-light', 'Attack with Crossbow, light', 'slug-2', 'Slug-Thing 2'],
    ['crossbow-light', 'Attack with Crossbow, light', 'slug-3', 'Slug-Thing 3'],
    ['longsword', 'Attack with Longsword', 'slug-1', 'Slug-Thing 1'],
    ['longsword', 'Attack with Longsword', 'slug-2', 'Slug-Thing 2'],
    ['longsword', 'Attack with Longsword', 'slug-3', 'Slug-Thing 3'],
  ])('posts the chosen target for %s / %s', async (weaponId, label, slugId, slugName) => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter() },
      refreshCombatState: vi.fn(),
    };
    render(<CombatActionBarLive {...defaultProps} />);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const trigger = await screen.findByRole('button', { name: /Other weapons and targets/i });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    await user.click(trigger);
    const items = await screen.findAllByRole('menuitem');
    const item = items.find((i) => i.textContent === `${label} → ${slugName}`) as HTMLElement;
    expect(item).toBeTruthy();
    await user.click(item);
    await waitFor(
      () => {
        expect(
          recorded.filter((r) => r.method === 'POST' && r.url.includes('/intent')).length,
        ).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    const dieCall = vi.mocked(askPlayerForAttackDie).mock.calls[0]?.[0] as {
      action: { target_ids: string[]; weapon_id: string | null };
    };
    expect(dieCall.action.target_ids).toEqual([slugId]);
    expect(dieCall.action.weapon_id).toBe(weaponId);
    for (const other of ['slug-1', 'slug-2', 'slug-3'].filter((s) => s !== slugId))
      expect(dieCall.action.target_ids).not.toContain(other);
    const attackPosts = recorded
      .filter((r) => r.method === 'POST' && r.url.includes('/intent'))
      .map(
        (r) => (r.body as { intent: { type: string; targetId: string; weaponId?: string } }).intent,
      )
      .filter((posted) => posted?.type === 'attack');
    expect(attackPosts).toHaveLength(1);
    const intent = attackPosts[0];
    expect(intent.targetId).toBe(slugId);
    expect(intent.weaponId).toBe(weaponId);
  });
});
