import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ACTION_BAR_FLEE_INTENT_BODY } from '../../../../../../shared/test-fixtures/combat-action-bar-intent';
import { CombatActionBarLive } from '../CombatActionBar';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';

const pcWire = {
  position: { x: 1, y: 1, sceneId: 'scene-1' },
  id: 'pc-1',
  characterId: 'char-pc-1',
  name: 'Mira',
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

const goblinWire = {
  position: { x: 2, y: 2, sceneId: 'scene-1' },
  id: 'goblin-1',
  characterId: null,
  name: 'Goblin',
  participantType: 'monster',
  initiative: 10,
  initiativeModifier: 0,
  turnOrder: 1,
  isActive: true,
  armorClass: 12,
  maxHp: 7,
  speed: 30,
  actionUsed: false,
  bonusActionUsed: false,
  reactionUsed: false,
  status: {
    currentHp: 7,
    maxHp: 7,
    tempHp: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  },
  vitalState: 'standing',
  conditions: [],
  monsterAttack: null,
};

const buildEncounter = (holder: 'pc-1' | 'goblin-1') =>
  mapAuthoritativeCombat({
    encounter: {
      id: 'enc-1',
      sessionId: 'sess-1',
      status: 'active',
      currentRound: 1,
      currentTurnOrder: holder === 'pc-1' ? 0 : 1,
      startedAt: '2026-10-05T23:43:11.584Z',
    },
    participants: [pcWire, goblinWire],
  } as never);

type CombatValue = {
  state: { isInCombat: boolean; activeEncounter: ReturnType<typeof buildEncounter> | null };
  refreshCombatState: () => void;
};
const combatHolder = vi.hoisted(() => ({ current: undefined as CombatValue | undefined }));
const pack = vi.hoisted(() => ({
  inventory: [] as Array<{ id: string; name: string }>,
  cantrips: [] as Array<Record<string, unknown>>,
  spellcasting: null as Record<string, unknown> | null,
}));

vi.mock('@/services/combat/player-spell-cast', () => ({ askPlayerForSpellCast: vi.fn() }));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => combatHolder.current,
  useOptionalCombat: () => combatHolder.current,
}));

vi.mock('../overhaul/useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    character: {
      spells: { cantrips: pack.cantrips, known: [], prepared: [] },
      spellcasting: pack.spellcasting,
      inventory: pack.inventory,
      attacks: [{ id: 'longsword', name: 'Longsword', bonus: '+5', damage: '1d8+3' }],
    },
  }),
}));

vi.mock('../../tactical/TacticalMapProvider', () => ({
  useTacticalMapContext: () => null,
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({})),
}));

const legalPayload = {
  actorId: 'pc-1',
  actions: [
    {
      type: 'attack',
      label: 'Attack with Longsword',
      weaponId: 'longsword',
      targetIds: ['goblin-1'],
    },
    { type: 'flee', label: 'Flee (Goblin attacks)' },
    { type: 'yield', label: 'Yield' },
    { type: 'end_turn', label: 'End turn' },
  ],
};

const intentHolder = vi.hoisted(() => ({
  response: { ok: true, status: 200, json: async () => ({ result: {} }) } as any,
  reject: null as any,
  endTurnMode: 'ok' as 'ok' | 'refused' | 'network',
}));

let fetchSpy: any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  combatHolder.current = undefined;
  pack.inventory = [];
  pack.cantrips = [];
  pack.spellcasting = null;
  intentHolder.response = { ok: true, status: 200, json: async () => ({ result: {} }) };
  intentHolder.reject = null;
  intentHolder.endTurnMode = 'ok';
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url.endsWith('/legal-actions')) {
      return { ok: true, json: async () => legalPayload } as Response;
    }
    if (url.endsWith('/intent')) {
      const body = JSON.parse(init?.body || '{}');
      if (body.intent?.type === 'end_turn') {
        if (intentHolder.endTurnMode === 'refused') {
          return {
            ok: false,
            status: 422,
            json: async () => ({
              error: 'Actor is not the current-turn participant',
              details: { currentParticipantId: 'goblin-1' },
            }),
          } as Response;
        }
      }
      if (intentHolder.reject) throw intentHolder.reject;
      return intentHolder.response as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const defaultProps = {
  turnInFlight: false,
  onSendMessage: vi.fn().mockResolvedValue(undefined),
  onSendText: vi.fn().mockResolvedValue(undefined),
  onMove: vi.fn().mockResolvedValue(undefined),
};

describe('CombatActionBar flee #1169', () => {
  it('clicking More -> Flee posts the flee intent the server expects (#1169)', async () => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: vi.fn(),
    };
    render(<CombatActionBarLive {...defaultProps} />);
    const user = userEvent.setup();
    const more = await screen.findByRole('button', { name: /^More/ });
    await waitFor(() => expect(more).not.toBeDisabled());
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Flee (Goblin attacks)' }));
    const group = await screen.findByRole('group', { name: 'Confirm flee' });
    expect(group).toHaveTextContent('Flee? Goblin gets one attack as you turn.');
    await user.click(screen.getByRole('button', { name: 'Flee anyway' }));
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c: any) =>
        String(c[0]).endsWith('/v1/combat/enc-1/intent'),
      );
      expect(call).toBeTruthy();
    });
    const call = fetchSpy.mock.calls.find((c: any) =>
      String(c[0]).endsWith('/v1/combat/enc-1/intent'),
    );
    expect((call as any)[1].method).toBe('POST');
    expect(JSON.parse((call as any)[1].body)).toEqual({
      ...ACTION_BAR_FLEE_INTENT_BODY,
      dmStartedAt: expect.any(Number),
    });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('Stay posts nothing', async () => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: vi.fn(),
    };
    render(<CombatActionBarLive {...defaultProps} />);
    const user = userEvent.setup();
    const more = await screen.findByRole('button', { name: /^More/ });
    await waitFor(() => expect(more).not.toBeDisabled());
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Flee (Goblin attacks)' }));
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Confirm flee' })).toBeNull());
    const intentCalls = fetchSpy.mock.calls.filter((c: any) => String(c[0]).endsWith('/intent'));
    expect(intentCalls).toHaveLength(0);
  });

  it('an intent refusal shows in the bar (#1169)', async () => {
    intentHolder.response = {
      ok: false,
      status: 422,
      json: async () => ({ error: 'Only a standing character can flee or yield' }),
    };
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: vi.fn(),
    };
    render(<CombatActionBarLive {...defaultProps} />);
    const user = userEvent.setup();
    const more = await screen.findByRole('button', { name: /^More/ });
    await waitFor(() => expect(more).not.toBeDisabled());
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Flee (Goblin attacks)' }));
    await user.click(screen.getByRole('button', { name: 'Flee anyway' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Only a standing character can flee or yield');
  });

  it('a thrown network error shows in the bar', async () => {
    intentHolder.reject = new TypeError('Failed to fetch');
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: vi.fn(),
    };
    render(<CombatActionBarLive {...defaultProps} />);
    const user = userEvent.setup();
    const more = await screen.findByRole('button', { name: /^More/ });
    await waitFor(() => expect(more).not.toBeDisabled());
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Flee (Goblin attacks)' }));
    await user.click(screen.getByRole('button', { name: 'Flee anyway' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to fetch');
  });

  it('End turn after the turn already moved is not an error (#1169)', async () => {
    intentHolder.endTurnMode = 'refused';
    const refresh = vi.fn();
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: refresh,
    };
    render(<CombatActionBarLive {...defaultProps} />);
    const user = userEvent.setup();
    const endTurnBtn = await screen.findByRole('button', { name: /^End turn/ });
    await waitFor(() => expect(endTurnBtn).not.toBeDisabled());
    await user.click(endTurnBtn);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
