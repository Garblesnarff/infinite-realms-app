/**
 * #1023: the opening's option buttons render with the opening text. "Show scene
 * art" is a separate control and must not be what reveals them.
 *
 * Fixture follows the greeting producer (use-initial-greeting.ts): schema option
 * lines appended under the scene, shaped `A. **Bold**, description`
 * (context-builder-prompts.ts). The reloaded row stores `initial_greeting`
 * (use-message-queue.ts). A later narration keeps the 10s roleplay delay.
 *
 * Real: MessageRenderer, DMMessage, MessageAssetDisplay, DynamicOptionsSection,
 * ActionOptions. Stubbed: combat, campaign assets, scene background, voice.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageRenderer } from '../MessageRenderer';

import type { ChatMessage } from '@/types/game';

const combat = vi.hoisted(() => ({ isInCombat: false, activeEncounter: null as null }));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: combat }),
  useOptionalCombat: () => ({ state: combat }),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn(), assets: [] }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));

const SCENE = 'Ines Calado waits at the garden gate, one hand on the latch.';
const OPTIONS = [
  'A. **Ask Ines what she saw**, hear who passed the gate.',
  'B. **Check the gate latch**, see if it was forced.',
  'C. **Step into the garden**, look for tracks.',
  'D. **Call for Clarice**, bring her to the gate.',
] as const;

const openingText = `${SCENE}\n\n${OPTIONS.join('\n')}`;

function renderMessage(message: ChatMessage): ReturnType<typeof render> {
  return render(
    <MessageRenderer
      message={message}
      messageId="dm-opening"
      groupIndex={0}
      msgIndex={0}
      isFirstInGroup
      isLastInGroup
      isPlayer={false}
      isDM
      isCompanion={false}
      expandedMessages={new Set()}
      setExpandedMessages={vi.fn() as never}
      imageByMessage={{}}
      generatingFor={new Set()}
      genErrorByMessage={{}}
      onGenerateScene={vi.fn().mockResolvedValue(undefined)}
      onOptionSelect={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

async function flushOpeningDelay(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('MessageRenderer opening options (#1023)', () => {
  beforeEach(() => {
    combat.isInCombat = false;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the four opening buttons with the scene text and the scene-art control, without a click', async () => {
    renderMessage({
      text: openingText,
      sender: 'dm',
      context: { initialGreeting: true, noActionOptions: false },
    });

    expect(screen.getByText(SCENE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show scene art' })).toBeInTheDocument();

    await flushOpeningDelay();

    expect(screen.getByRole('button', { name: /Ask Ines what she saw/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check the gate latch/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Step into the garden/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Call for Clarice/ })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading suggested actions' })).toBeNull();
  });

  it('shows the same buttons when the reloaded row only has initial_greeting', async () => {
    renderMessage({
      text: openingText,
      sender: 'dm',
      context: { initial_greeting: true },
    });

    await flushOpeningDelay();

    expect(screen.getByRole('button', { name: /Ask Ines what she saw/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show scene art' })).toBeInTheDocument();
  });

  it('keeps a later narration on the roleplay delay', async () => {
    renderMessage({
      text: openingText,
      sender: 'dm',
      context: { noActionOptions: false },
    });

    await flushOpeningDelay();
    expect(screen.queryByRole('button', { name: /Ask Ines what she saw/ })).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading suggested actions' })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9999);
    });
    expect(screen.queryByRole('button', { name: /Ask Ines what she saw/ })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole('button', { name: /Ask Ines what she saw/ })).toBeInTheDocument();
  });
});
