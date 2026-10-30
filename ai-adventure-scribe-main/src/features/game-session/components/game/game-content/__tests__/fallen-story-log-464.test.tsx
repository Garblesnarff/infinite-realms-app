import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { DM_TEXT, state } = vi.hoisted(() => {
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
  const state: { messages: Array<{ id: string; sender: string; text: string }> } = {
    messages: [{ id: 'm1', sender: 'dm', text: DM_TEXT }],
  };
  return { DM_TEXT, state };
});

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({ messages: state.messages }),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn(), assets: [] }),
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

  it('renders the location and bold choice as clean prose', () => {
    state.messages = [
      {
        id: 'd1',
        sender: 'dm',
        text: '[ASSET:location:base-camp-alpha] Base Camp Alpha\n\n**Question the Professor**',
      },
    ];
    render(<FallenStoryLog />);
    const log = screen.getByTestId('death-screen-story-log');
    expect(log).toHaveTextContent('Base Camp Alpha');
    expect(log).toHaveTextContent('Question the Professor');
    expect(log).not.toHaveTextContent('[ASSET:');
    expect(log).not.toHaveTextContent('**');
    state.messages = [{ id: 'm1', sender: 'dm', text: DM_TEXT }];
  });

  it('keeps player text including A./--- lines and omits system messages', () => {
    const playerText = 'I pick one:\nA. Climb the stair\n---\nB. Wait here';
    const systemText = 'Session saved.\n---\nC. Checkpoint 3';
    state.messages = [
      { id: 'p1', sender: 'player', text: playerText },
      { id: 's1', sender: 'system', text: systemText },
    ];
    render(<FallenStoryLog />);
    const log = screen.getByTestId('death-screen-story-log');
    expect(log.textContent).toContain('A. Climb the stair');
    expect(log.textContent).toContain('B. Wait here');
    expect(log.textContent).not.toContain('C. Checkpoint 3');
    state.messages = [{ id: 'm1', sender: 'dm', text: DM_TEXT }];
  });

  it('filters after preparing: roll-only and engine-only DM rows render no header', () => {
    state.messages = [
      { id: 'm1', sender: 'dm', text: DM_TEXT },
      {
        id: 'm2',
        sender: 'dm',
        text: '```ROLL_REQUESTS_V1\n{"rolls":[{"type":"check","formula":"1d20","purpose":"Stealth","dc":12}]}\n```',
      },
      { id: 'm3', sender: 'dm', text: '⚙️ Engine: The Storyteller rolled 9 vs DC 12 — FAIL.' },
    ];
    render(<FallenStoryLog />);
    expect(screen.getByTestId('death-screen-story-log').children).toHaveLength(1);
    state.messages = [{ id: 'm1', sender: 'dm', text: DM_TEXT }];
  });

  it('shows story and actions without internal messages or role labels', () => {
    state.messages = [
      {
        id: 'd1',
        sender: 'dm',
        text: 'The door opens.\n⚙️ Engine: A roll was made.\nThe chamber is dark.',
      },
      { id: 'p1', sender: 'player', text: 'I raise my lantern.' },
      {
        id: 's1',
        sender: 'system',
        text: 'Combat ended - the party was defeated (reason: party_defeated)',
      },
      {
        id: 's2',
        sender: 'system',
        text: 'I encountered an issue processing your message. Let me try again, or you can rephrase your action if needed.',
      },
    ];
    render(<FallenStoryLog />);
    const log = screen.getByTestId('death-screen-story-log');
    expect(log).toHaveTextContent('The door opens.');
    expect(log).toHaveTextContent('The chamber is dark.');
    expect(log).toHaveTextContent('I raise my lantern.');
    expect(log).not.toHaveTextContent('Engine:');
    expect(log).not.toHaveTextContent('party_defeated');
    expect(log).not.toHaveTextContent('I encountered an issue');
    expect(log).not.toHaveTextContent(/System|Dungeon Master|You/);
    state.messages = [{ id: 'm1', sender: 'dm', text: DM_TEXT }];
  });
});
