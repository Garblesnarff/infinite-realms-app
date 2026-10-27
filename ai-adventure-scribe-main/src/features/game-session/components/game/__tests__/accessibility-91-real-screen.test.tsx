/* eslint-disable max-lines */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiceRollRequest } from '@/components/game/DiceRollRequest';
import { GameMainContent } from '@/features/game-session/components/game/game-content/GameMainContent';

const turn = vi.hoisted(() => ({
  phase: 'bar' as 'bar' | 'roll' | 'done',
  rerender: (() => {}) as () => void,
}));

const attackAction = {
  type: 'attack' as const,
  label: 'Attack with Longsword',
  weaponId: 'longsword',
  targetIds: ['goblin-1'],
};
const endTurnAction = { type: 'end_turn' as const, label: 'End turn' };

vi.mock('@/contexts/CombatContext', () => ({
  useOptionalCombat: () => ({
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'encounter-91',
        currentRound: 1,
        currentTurnParticipantId: 'hero-1',
        participants: [
          {
            id: 'hero-1',
            name: 'Mira',
            participantType: 'player',
            characterId: 'character-91',
          },
          { id: 'goblin-1', name: 'Goblin', participantType: 'monster' },
        ],
      },
    },
  }),
  useCombat: () => ({
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'encounter-91',
        currentRound: 1,
        currentTurnParticipantId: 'hero-1',
        participants: [
          {
            id: 'hero-1',
            name: 'Mira',
            participantType: 'player',
            characterId: 'character-91',
          },
          { id: 'goblin-1', name: 'Goblin', participantType: 'monster' },
        ],
      },
    },
    refreshCombatState: vi.fn(),
  }),
}));

vi.mock('@/features/game-session/hooks/use-combat-legal-actions', () => ({
  useCombatLegalActions: () => ({
    actions: turn.phase === 'bar' ? [attackAction] : turn.phase === 'done' ? [endTurnAction] : [],
    isPlayerTurn: turn.phase !== 'roll',
    isRefreshing: false,
    error: null,
    loadFailed: false,
    retryLoad: vi.fn(async () => {}),
    runAction: vi.fn(async (action: { type: string }) => {
      if (action.type === 'attack') {
        turn.phase = 'roll';
        turn.rerender();
      } else if (action.type === 'end_turn') {
        turn.phase = 'done';
        turn.rerender();
      }
    }),
  }),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: {
      character: {
        id: 'character-91',
        name: 'Mira',
        abilityScores: {
          strength: { score: 20, modifier: 5 },
          dexterity: { score: 10, modifier: 0 },
          constitution: { score: 10, modifier: 0 },
          intelligence: { score: 10, modifier: 0 },
          wisdom: { score: 10, modifier: 0 },
          charisma: { score: 10, modifier: 0 },
        },
      },
    },
  }),
  useOptionalCharacter: () => ({ state: { character: { id: 'character-91', name: 'Mira' } } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: { id: 'campaign-91', name: 'Campaign 91' } } }),
  useOptionalCampaign: () => ({ state: { campaign: { difficulty_level: 'normal' } } }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    state: {
      diceRollQueue: {
        pendingRolls:
          turn.phase === 'roll'
            ? [{ id: 'attack-roll-91', status: 'pending', requestType: 'attack' }]
            : [],
        currentRollId: turn.phase === 'roll' ? 'attack-roll-91' : null,
        isProcessingRoll: false,
        completedBatchRolls: [],
      },
    },
    getCurrentDiceRoll: () => null,
  }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({ queueStatus: 'idle', sendMessage: vi.fn(async () => {}) }),
}));
vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => ({
    campaigns: [],
    featuredCampaigns: [],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/services/ai/dm-wait', () => ({ useDmWaiting: () => false }));
vi.mock('@/services/combat/sheet-cast-progress', () => ({
  useSheetCastProgress: () => ({ cast: null }),
}));
vi.mock('@/features/game-session/hooks/use-show-target-numbers', () => ({
  useShowTargetNumbers: () => ({ showTargetNumbers: true, setShowTargetNumbers: vi.fn() }),
}));
vi.mock('../overhaul/useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    scene: { title: 'THE LIVE CAMPAIGN', blurb: 'A ruined watchtower stands nearby.' },
    campaign: { chapter: 'Chapter 1' },
    character: {
      attacks: [{ id: 'longsword', name: 'Longsword', bonus: '+5' }],
      spells: { cantrips: [], known: [] },
      spellcasting: null,
    },
  }),
}));
vi.mock('../overhaul/CombatTurnBar', () => ({ CombatTurnBarLive: () => null }));
vi.mock('../overhaul/SceneHeader', () => ({
  SceneHeader: ({ title, blurb }: { title: string; blurb?: string }) => (
    <header>
      {title}: {blurb}
    </header>
  ),
}));
vi.mock('../TimelineRail', () => ({ TimelineRail: () => null }));
vi.mock('../StatsBar', () => ({ StatsBar: () => null }));
vi.mock('../game-content/GamePanelControls', () => ({ GamePanelControls: () => null }));
vi.mock('../../tactical/TacticalMapProvider', () => ({
  useTacticalMapContext: () => null,
}));
vi.mock('../../tactical/TacticalMapBoard', () => ({ TacticalMapBoard: () => null }));
vi.mock('@/components/safety/SafetyBanner', () => ({ SafetyBanner: () => null }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/features/game-session/components', () => ({
  DiceRollEmbed: ({ onRoll }: { onRoll: (result: number) => void }) => (
    <button type="button" onClick={() => onRoll(20)}>
      Resolve deterministic d20
    </button>
  ),
}));
vi.mock('@/hooks/game/use-dice-roll-request', () => ({
  useDiceRollRequest: ({ onResult }: { onResult: (result: number) => void }) => ({
    manualMode: false,
    manualResult: '',
    setManualResult: vi.fn(),
    hasAdvantage: false,
    hasDisadvantage: false,
    showDiceAnimation: true,
    isRolling: false,
    isSubmitting: false,
    character: { id: 'character-91' },
    rollCalculation: {
      formula: '1d20+5',
      breakdown: ['1d20', 'STR +5'],
      totalModifier: 5,
      isProficient: true,
      modifierUnknown: false,
    },
    resolvedFormula: '1d20+5',
    effectiveManualMode: false,
    handleAutoRoll: () => onResult(20),
    handleDiceRollComplete: (result: number) => onResult(result),
    handleManualSubmit: vi.fn(),
    handleEnterManually: vi.fn(),
    handleBackToRoll: vi.fn(),
    resetAfterFailedSubmit: vi.fn(),
    toggleAdvantage: vi.fn(),
    toggleDisadvantage: vi.fn(),
  }),
}));

vi.mock('../../chat/MessageList', async () => {
  const { RollTray } = await import('../game-content/roll-tray-slot');
  return {
    MessageList: () => (
      <div data-testid="real-game-screen-message-list">
        {turn.phase === 'roll' && (
          <RollTray>
            <DiceRollRequest
              request={{
                type: 'attack',
                formula: '1d20+5',
                purpose: 'Longsword attack vs Goblin',
                ac: 12,
              }}
              onResult={() => {
                turn.phase = 'done';
                turn.rerender();
              }}
            />
          </RollTray>
        )}
      </div>
    ),
  };
});
vi.mock('../message/MessageHandler', () => ({
  MessageHandler: ({
    children,
  }: {
    children: (args: Record<string, unknown>) => React.ReactNode;
  }) =>
    children({
      handleSendMessage: vi.fn(async () => {}),
      isProcessing: false,
      isReconnecting: false,
      isStillThinking: false,
      attackWaitLabel: null,
      sendError: null,
      onRetry: vi.fn(),
      retryInFlight: false,
      combatTurnUiState: { preflight: 'idle', holder: null, pendingIntent: null },
      onResumeTurn: vi.fn(),
      terminalDeathState: null,
    }),
}));

function RealGameScreenKeyboardTurn(): React.ReactElement {
  const [, forceRender] = React.useReducer((value) => value + 1, 0);
  turn.rerender = forceRender;
  return (
    <GameMainContent
      sessionId="session-91"
      campaignIdForHandler="campaign-91"
      characterIdForHandler="character-91"
      sessionData={
        {
          id: 'session-91',
          turn_count: 1,
          current_scene_description: 'A ruined watchtower stands nearby.',
        } as never
      }
      updateGameSessionState={vi.fn()}
      showSceneBlurb
      onSceneBlurbToggle={vi.fn()}
      isLeftCollapsed={false}
      isRightCollapsed={false}
      onLeftToggle={vi.fn()}
      onRightToggle={vi.fn()}
      showTracker={false}
      setShowTracker={vi.fn()}
      isCombatDetected
      isGeneratingGreeting={false}
      innerHandleAIResponse={vi.fn(async () => {})}
      spellCastHandlerRef={{ current: null }}
      contentWarnings={[]}
      comfortLevel="pg"
      showSafetyInfo={false}
    />
  );
}

describe('real game-screen keyboard path (#91)', () => {
  beforeEach(() => {
    turn.phase = 'bar';
  });

  it('keeps the action bar before the chat box in the game-screen tab order', () => {
    render(<RealGameScreenKeyboardTurn />);
    const bar = screen.getByRole('toolbar', { name: 'Your actions' });
    const chat = screen.getByRole('textbox', {
      name: /describe what your character would like to do/i,
    });
    expect(bar.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('drives the real game screen bar and roll dialog with keyboard activation', async () => {
    render(<RealGameScreenKeyboardTurn />);
    const user = userEvent.setup();
    const attack = screen.getByRole('button', { name: /^Attack/ });
    attack.focus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /Longsword attack vs Goblin/i }),
      ).toBeInTheDocument(),
    );
    const roll = screen.getByRole('button', {
      name: /Roll 1d20\+5 for Longsword attack vs Goblin/i,
    });
    roll.focus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^End turn/ })).toBeInTheDocument(),
    );
    const endTurn = screen.getByRole('button', { name: /^End turn/ });
    endTurn.focus();
    await user.keyboard('{Enter}');
    expect(turn.phase).toBe('done');
  });
});
