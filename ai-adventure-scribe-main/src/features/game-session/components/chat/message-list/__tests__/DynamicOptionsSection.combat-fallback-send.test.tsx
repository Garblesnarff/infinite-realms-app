/**
 * #760: a combat chip the engine does not run still sends, even while the
 * composer provider is mounted. Staging is only for ordinary free-text options.
 *
 * Real: DynamicOptionsSection, useCombatLegalActions (the onSendText fallback),
 * ActionOptions, ComposerDraftProvider, ChatInput.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatInput } from '../../ChatInput';
import { ComposerDraftProvider } from '../../composer-draft';
import { DynamicOptionsSection } from '../DynamicOptionsSection';

import { PENDING_INPUT_STORAGE_KEY } from '@/services/auth/TokenService';

const combat = vi.hoisted(() => ({
  isInCombat: true,
  activeEncounter: {
    id: 'enc-1',
    currentTurnParticipantId: 'pc-1',
    participants: [{ id: 'pc-1', participantType: 'player' }],
  } as {
    id: string;
    currentTurnParticipantId: string;
    participants: Array<{ id: string; participantType: string }>;
  } | null,
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: combat, refreshCombatState: vi.fn() }),
}));

describe('combat text fallback still sends (#760)', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    combat.isInCombat = true;
    sessionStorage.removeItem(PENDING_INPUT_STORAGE_KEY);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: 'pc-1',
        actions: [{ type: 'help', label: 'Help your ally' }],
      }),
    } as Response);
  });

  it('sends the chip label and leaves the composer empty', async () => {
    const onOptionSelect = vi.fn().mockResolvedValue(undefined);
    const onComposerSend = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerDraftProvider>
        <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />
        <ChatInput onSendMessage={onComposerSend} isDisabled={false} />
      </ComposerDraftProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Option 1 - Help your ally' }));

    await waitFor(() => expect(onOptionSelect).toHaveBeenCalledWith('Help your ally'));
    expect(onOptionSelect).toHaveBeenCalledTimes(1);
    expect(onComposerSend).not.toHaveBeenCalled();
    expect(
      screen.getByRole('textbox', { name: 'Describe what your character would like to do' }),
    ).toHaveValue('');
  });
});
