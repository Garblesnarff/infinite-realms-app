import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ACTION_BAR_CAST_INTENT } from '../../../../../../shared/test-fixtures/combat-action-bar-intent';
import {
  COMBAT_CHAT_PLACEHOLDER,
  CombatActionBarLive,
  useCombatChatPlaceholder,
} from '../CombatActionBar';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import { askPlayerForSpellCast } from '@/services/combat/player-spell-cast';

// Encounter fixture built with the real mapper over a server-shaped payload
// (producer: mapAuthoritativeCombat over the /v1/combat/:sessionId/active payload).
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

// Only the engine call is stubbed: the hook's own flee/yield branch runs for real.
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeAuthoritativeCombatIntent: vi.fn().mockResolvedValue({}),
  executeStructuredCombatActionWithBoundary: vi
    .fn()
    .mockResolvedValue({ outcomes: [], result: { results: [] }, boundary: null }),
}));
// The tray prompt; its real behaviour against the route is in
// server-bun/src/routes/v1/combat/__tests__/player-spell-turn-real-resolver.test.ts (#1143).
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

function PlaceholderProbe() {
  const p = useCombatChatPlaceholder();
  return <span data-testid="placeholder">{p}</span>;
}

const playerPayload = {
  actorId: 'pc-1',
  actions: [
    {
      type: 'attack',
      label: 'Attack with Longsword',
      weaponId: 'longsword',
      targetIds: ['goblin-1'],
    },
    { type: 'dash', label: 'Dash' },
    { type: 'dodge', label: 'Dodge' },
    { type: 'disengage', label: 'Disengage' },
    { type: 'flee', label: 'Flee' },
    { type: 'yield', label: 'Yield' },
    { type: 'end_turn', label: 'End turn' },
  ],
};

const enemyPayload = { actorId: 'goblin-1', actions: [] };

const defaultProps = {
  turnInFlight: false,
  onSendMessage: vi.fn().mockResolvedValue(undefined),
  onSendText: vi.fn().mockResolvedValue(undefined),
  onMove: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  combatHolder.current = undefined;
  pack.inventory = [];
  pack.cantrips = [];
  pack.spellcasting = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CombatActionBarLive', () => {
  it('out of combat: renders nothing and fetch is not called; placeholder shows nothing', () => {
    combatHolder.current = {
      state: { isInCombat: false, activeEncounter: null },
      refreshCombatState: vi.fn(),
    };
    vi.spyOn(globalThis, 'fetch');
    render(<CombatActionBarLive {...defaultProps} />);
    expect(screen.queryByTestId('combat-action-bar')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Your actions' })).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    render(<PlaceholderProbe />);
    expect(screen.getAllByTestId('placeholder')[0].textContent).toBe('');
  });

  it('no CombatProvider: renders nothing, no throw', () => {
    combatHolder.current = undefined;
    expect(() => render(<CombatActionBarLive {...defaultProps} />)).not.toThrow();
    expect(screen.queryByTestId('combat-action-bar')).toBeNull();
  });

  it('your turn: toolbar shows, Attack enabled with sub label, Cast and Use item absent, Move disabled, placeholder shows COMBAT_CHAT_PLACEHOLDER', async () => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: vi.fn(),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => playerPayload,
    } as Response);

    render(<CombatActionBarLive {...defaultProps} />);
    render(<PlaceholderProbe />);

    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: 'Your actions' })).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('Longsword · +5')).toBeTruthy();
    });

    const attackBtn = screen.getByRole('button', { name: /Attack/i });
    expect(attackBtn).not.toBeDisabled();
    expect(screen.queryByText('Cast')).toBeNull();
    expect(screen.queryByText('Use item')).toBeNull();

    const moveBtn = screen.getByRole('button', { name: /Move/i });
    expect(moveBtn).toBeDisabled();

    const placeholders = screen.getAllByTestId('placeholder');
    const last = placeholders[placeholders.length - 1];
    expect(last.textContent).toBe(COMBAT_CHAT_PLACEHOLDER);
  });

  it('enemy turn: every toolbar button disabled; placeholder renders exactly enemy turn text', async () => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('goblin-1') },
      refreshCombatState: vi.fn(),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => enemyPayload,
    } as Response);

    render(<CombatActionBarLive {...defaultProps} />);
    render(<PlaceholderProbe />);

    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: 'Your actions' })).toBeTruthy();
    });

    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    toolbar.querySelectorAll('button').forEach((btn) => {
      expect(btn).toBeDisabled();
    });

    const placeholders = screen.getAllByTestId('placeholder');
    const last = placeholders[placeholders.length - 1];
    expect(last.textContent).toBe("Wait — it is the Goblin's turn");
  });

  it('turn in flight: all buttons disabled on player turn', async () => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: vi.fn(),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => playerPayload,
    } as Response);

    render(<CombatActionBarLive {...defaultProps} turnInFlight={true} />);

    // The legal actions have landed (the sub label comes from them), and still nothing is live.
    await waitFor(() => {
      expect(screen.getByText('Longsword · +5')).toBeTruthy();
    });

    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    toolbar.querySelectorAll('button').forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('Flee and Yield from More run the exit intents through the hook (#1143)', async () => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: vi.fn(),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => playerPayload,
    } as Response);
    const onSendText = vi.fn().mockResolvedValue(undefined);
    render(<CombatActionBarLive {...defaultProps} onSendText={onSendText} />);
    const user = userEvent.setup();
    const more = await screen.findByRole('button', { name: /^More/ });
    await waitFor(() => expect(more).not.toBeDisabled());
    await user.click(more);
    await user.click(await screen.findByRole('menuitem', { name: 'Flee' }));
    await waitFor(() =>
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        { type: 'flee', actorId: 'pc-1' },
        'dm',
        expect.any(Number),
        'action_bar',
      ),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^More/ })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: /^More/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Yield' }));
    await waitFor(() =>
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        { type: 'yield', actorId: 'pc-1' },
        'dm',
        expect.any(Number),
        'action_bar',
      ),
    );
    // Engine intents, never chat text for the DM to narrate.
    expect(onSendText).not.toHaveBeenCalled();
  });

  it('shows no Use item even with a consumable in the pack (#1143: no engine item intent)', async () => {
    pack.inventory = [{ id: 'potion-of-healing', name: 'Potion of Healing' }];
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: vi.fn(),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => playerPayload,
    } as Response);
    render(<CombatActionBarLive {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Longsword · +5')).toBeTruthy());
    expect(screen.queryByText('Use item')).toBeNull();
    expect(screen.queryByText(/Potion of Healing/)).toBeNull();
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 500', () => Promise.resolve({ ok: false, status: 500 } as Response)],
  ])('says "Could not load actions — retry" after %s, and retry loads them', async (_, fail) => {
    combatHolder.current = {
      state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
      refreshCombatState: vi.fn(),
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(fail as () => Promise<Response>)
      .mockResolvedValue({ ok: true, json: async () => playerPayload } as Response);
    render(<CombatActionBarLive {...defaultProps} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load actions — retry');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByText('Longsword · +5')).toBeTruthy());
    expect(screen.queryByText(/Could not load actions/)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /^End turn/ })).not.toBeDisabled();
  });

  describe('Cast Chill Touch from the bar (#1143)', () => {
    // Legal action as getLegalCombatActions returns it for a known attack cantrip.
    const chillTouch = {
      type: 'spell',
      label: 'Cast Chill Touch',
      spellId: 'chill-touch',
      targetIds: ['goblin-1'],
    };
    const setup = () => {
      pack.cantrips = [
        { id: 'chill-touch', name: 'Chill Touch', range: '120 feet', castingTime: '1 action' },
      ];
      pack.spellcasting = { ability: 'INT' };
      combatHolder.current = {
        state: { isInCombat: true, activeEncounter: buildEncounter('pc-1') },
        refreshCombatState: vi.fn(),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          actorId: 'pc-1',
          actions: [
            ...playerPayload.actions.slice(0, -1),
            chillTouch,
            { type: 'end_turn', label: 'End turn' },
          ],
        }),
      } as Response);
    };
    const chooseChillTouch = async () => {
      const user = userEvent.setup();
      const cast = await screen.findByRole('button', { name: /^Cast/ });
      await waitFor(() => expect(cast).not.toBeDisabled());
      await user.click(cast);
      const item = (await screen.findAllByRole('menuitem')).find((menuItem) =>
        menuItem.textContent?.startsWith('Cast Chill Touch → Goblin'),
      )!;
      expect(item).toHaveTextContent('120 feet · action');
      await user.click(item);
    };

    it('sends the cast intent the route resolves: tray prompt, then the commit with the die', async () => {
      setup();
      vi.mocked(askPlayerForSpellCast).mockResolvedValue({
        d20: 15,
        autoRolled: false,
        movementOnly: false,
      });
      const onSendText = vi.fn().mockResolvedValue(undefined);
      render(<CombatActionBarLive {...defaultProps} onSendText={onSendText} />);
      await chooseChillTouch();
      await waitFor(() =>
        expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
          'enc-1',
          ACTION_BAR_CAST_INTENT,
          15,
          undefined,
          'action_bar',
        ),
      );
      expect(askPlayerForSpellCast).toHaveBeenCalledWith(
        expect.objectContaining({ encounterId: 'enc-1', action: ACTION_BAR_CAST_INTENT }),
      );
      // A spell attack, not a move toward the target, and not chat text for the DM.
      expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalledWith(
        'enc-1',
        expect.objectContaining({ type: 'move' }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(onSendText).not.toHaveBeenCalled();
    });

    it('shows the engine refusal for an out-of-range cast, spends nothing, and keeps End turn enabled', async () => {
      setup();
      // The shape askPlayerForSpellCast returns for the route's 422 (real-resolver suite).
      vi.mocked(askPlayerForSpellCast).mockResolvedValue({
        autoRolled: true,
        movementOnly: false,
        refusal:
          'Spell refused: Chill Touch: Goblin is out of its 120-foot reach — move closer and cast it again',
      });
      render(<CombatActionBarLive {...defaultProps} />);
      await chooseChillTouch();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Spell refused: Chill Touch: Goblin is out of its 120-foot reach — move closer and cast it again. Nothing was spent.',
      );
      expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^End turn/ })).not.toBeDisabled(),
      );
    });
  });
});
