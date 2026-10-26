import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageRenderer } from '../MessageRenderer';

import { CombatLegalActionsHarness } from '@/features/game-session/hooks/__tests__/combat-legal-actions-harness';
import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';

// #90: these cases used to drive DynamicOptionsSection's in-chat combat menu. The menu is gone;
// the list hides DM options during an encounter (MessageRenderer `encounterActive`) and the
// ActionBar's hook (useCombatLegalActions, via the harness) owns the legal actions.

const combat = vi.hoisted(() => ({ isInCombat: false, activeEncounter: null as any }));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: () => ({ state: combat }) }));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn().mockResolvedValue({}),
  executeStructuredCombatActionWithBoundary: vi.fn().mockResolvedValue({}),
}));
vi.mock('../DMMessage', () => ({
  DMMessage: ({ displayContent }: { displayContent: string }) => <p>{displayContent}</p>,
}));
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options, onOptionSelect }: { options: any[]; onOptionSelect: any }) => (
    <div data-testid="action-options">
      {options.map((opt, i) => (
        <button key={i} onClick={() => onOptionSelect(opt)}>
          {opt.text}
        </button>
      ))}
    </div>
  ),
}));

// Wire shape: GET /v1/combat/:id/legal-actions (getLegalCombatActions, combat-intent-service.ts).
function stubLegalActions(actions: Array<Record<string, unknown>>) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ actorId: 'pc-1', actions }),
  } as Response);
}

function renderDmMessage(message: Record<string, unknown>) {
  return (
    <MessageRenderer
      message={message as never}
      messageId="dm-1"
      groupIndex={0}
      msgIndex={0}
      isFirstInGroup
      isLastInGroup
      isPlayer={false}
      isDM
      isCompanion={false}
      encounterActive={combat.isInCombat}
      expandedMessages={new Set()}
      setExpandedMessages={vi.fn() as never}
      imageByMessage={{}}
      generatingFor={new Set()}
      genErrorByMessage={{}}
      onGenerateScene={vi.fn().mockResolvedValue(undefined)}
      onOptionSelect={vi.fn().mockResolvedValue(undefined)}
    />
  );
}

describe('combat legal actions (ActionBar hook) replace the chat options during combat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(executeAuthoritativeCombatIntent).mockClear();
    combat.isInCombat = true;
    combat.activeEncounter = {
      id: 'enc-1',
      currentTurnParticipantId: 'pc-1',
      participants: [{ id: 'pc-1', participantType: 'player' }],
    };
  });

  // Was DynamicOptionsSection.test.tsx 'replaces narration exploration options with server
  // legal actions during combat'.
  it('replaces narration exploration options with server legal actions during combat', async () => {
    stubLegalActions([{ type: 'dodge', label: 'Dodge' }]);
    // DM text follows the real producer (use-ai-response.ts appends `A. **Action**, …` lines).
    render(
      <>
        {renderDmMessage({
          text: 'The goblin snarls.\n\nA. **Option 1**, charge in\nB. **Option 2**, hang back',
          sender: 'dm',
        })}
        <CombatLegalActionsHarness onSendText={vi.fn().mockResolvedValue(undefined)} />
      </>,
    );
    await waitFor(() => expect(screen.getByText('Dodge')).toBeDefined());
    expect(screen.queryByText(/Option 1/, { selector: 'button' })).toBeNull();
  });

  // Was DynamicOptionsSection.test.tsx 'posts a planned Move to the engine and leaves DM text
  // out of the action path'.
  it('posts a planned Move to the engine and leaves DM text out of the action path', async () => {
    stubLegalActions([{ type: 'move', label: 'Move (30 ft remaining)', x: 6, y: 0 }]);
    const onSendText = vi.fn().mockResolvedValue(undefined);
    render(<CombatLegalActionsHarness onSendText={onSendText} />);
    fireEvent.click(await screen.findByText('Move (30 ft remaining)'));
    await waitFor(() =>
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        { type: 'move', actorId: 'pc-1', x: 6, y: 0 },
        'dm',
        expect.any(Number),
        'typed',
      ),
    );
    expect(onSendText).not.toHaveBeenCalled();
  });

  // Was DynamicOptionsSection.no-options-notice.test.tsx 'never shows the notice while the
  // combat menu owns the slot'.
  it('never shows the no-options notice while the ActionBar owns the turn', () => {
    stubLegalActions([]);
    render(
      renderDmMessage({
        text: 'The goblin circles you.',
        sender: 'dm',
        context: { noActionOptions: true },
      }),
    );
    expect(screen.queryByTestId('no-action-options-notice')).not.toBeInTheDocument();
  });
});
