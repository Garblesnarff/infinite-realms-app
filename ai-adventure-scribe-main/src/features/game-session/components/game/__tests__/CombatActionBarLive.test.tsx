import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMBAT_CHAT_PLACEHOLDER,
  CombatActionBarLive,
  useCombatChatPlaceholder,
} from '../CombatActionBar';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';

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

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => combatHolder.current,
  useOptionalCombat: () => combatHolder.current,
}));

vi.mock('../overhaul/useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    character: {
      spells: { cantrips: [], known: [], prepared: [] },
      spellcasting: null,
      inventory: [],
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
});
