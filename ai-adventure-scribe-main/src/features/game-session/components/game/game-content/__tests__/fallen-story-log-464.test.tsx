import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { DM_TEXT } = vi.hoisted(() => {
  const DM_TEXT = [
    'The torchlight catches on [ASSET:npc:professor-vale] Professor Vale\'s spectacles. She says, "**Mind the gap** on the eastern stair." The cold air smells faintly of *ozone.',
    '',
    'A low rumble answers from somewhere below.',
    '',
    '```ROLL_REQUESTS_V1',
    '{"rolls":[{"type":"check","formula":"1d20+2","purpose":"Perception","dc":14}]}',
    '```',
    '',
    "VISUAL PROMPT: A dim stone stairwell lit by a single torch, Professor Vale's silhouette above.",
    '',
    '⚙️ Engine: The Storyteller rolled 15 + 2 = 17 vs DC 14 — SUCCESS.',
  ].join('\n');
  return { DM_TEXT };
});

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [{ id: 'm1', sender: 'dm', text: DM_TEXT }],
  }),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn() }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('@/features/game-session/components/chat/message-list/MessageAssetDisplay', () => ({
  MessageAssetDisplay: () => null,
}));
vi.mock('@/features/game-session/components/chat/message-list/MessageVoicePlayer', () => ({
  MessageVoicePlayer: () => null,
}));

import { FallenStoryLog } from '../DeathScreen';

import { DMMessage } from '@/features/game-session/components/chat/message-list/DMMessage';

const renderChatNarrative = (): string => {
  const { container } = render(
    <DMMessage
      message={{ sender: 'dm', text: DM_TEXT }}
      messageId="dm-1"
      isFirstInGroup
      isLastInGroup
      displayContent={DM_TEXT}
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
    />,
  );
  const narrative = container.querySelector('.dm-narrative');
  expect(narrative).not.toBeNull();
  return narrative?.textContent ?? '';
};

describe('FallenStoryLog (#464)', () => {
  it('renders the exact chat display path for a DM message', () => {
    const chatText = renderChatNarrative();

    const { container } = render(<FallenStoryLog />);
    const storyText = container.querySelector('.whitespace-pre-wrap')?.textContent ?? '';

    expect(storyText).toBe(chatText);
  });

  it('drops asset tags, bold markers, visual prompts, roll requests and orphan asterisks', () => {
    render(<FallenStoryLog />);
    const log = screen.getByTestId('death-screen-story-log');
    const text = log.textContent ?? '';

    expect(text).not.toContain('[ASSET');
    expect(text).not.toContain('**');
    expect(text).not.toContain('*');
    expect(text).not.toContain('VISUAL PROMPT');
    expect(text).not.toContain('ROLL_REQUESTS_V1');
    expect(text).toContain('Professor Vale');
    expect(text).toContain('Mind the gap');
  });
});
