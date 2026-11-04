import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';

import { tableSettingsKey } from '@/features/settings/table-settings';

vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn(), assets: [] }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));

const mockUser = { id: 'user-a' as string | null };
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ user: mockUser.id ? { id: mockUser.id } : null }),
}));

/** Rolls shaped like the real producer (executeNPCRoll in npc-auto-roller.ts). */
const npcRolls = [
  {
    request: {
      actorName: 'Goblin',
      purpose: 'attacks with a shortbow',
      type: 'attack',
      formula: '1d20+4',
      ac: 14,
      autoExecute: true,
    },
    result: {
      total: 18,
      naturalRoll: 14,
      critical: false,
      rolls: [{ dice: 20, value: 14 }],
    },
    timestamp: new Date('2026-11-04T12:00:00Z'),
  },
  {
    request: {
      actorName: 'Orc',
      purpose: 'makes a Strength save',
      type: 'save',
      formula: '1d20+2',
      dc: 12,
      autoExecute: true,
    },
    result: {
      total: 9,
      naturalRoll: 7,
      critical: false,
      rolls: [{ dice: 20, value: 7 }],
    },
    timestamp: new Date('2026-11-04T12:00:00Z'),
  },
];

const renderMessage = (context: Record<string, unknown>): ReturnType<typeof render> =>
  render(
    <DMMessage
      message={{ sender: 'dm', text: 'The goblins press their attack.', context }}
      messageId="dm-1"
      isFirstInGroup
      isLastInGroup
      displayContent="The goblins press their attack."
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
    />,
  );

const seedSetting = (showNPCRolls: boolean): void => {
  window.localStorage.setItem(tableSettingsKey('user-a'), JSON.stringify({ showNPCRolls }));
};

describe('NPC roll summary (#1347 last item)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUser.id = 'user-a';
  });

  it('renders the Behind the Screen summary under the narration when the setting is on', () => {
    seedSetting(true);
    renderMessage({ npcRollResults: npcRolls });

    const summary = screen.getByTestId('npc-roll-summary');
    expect(summary).toHaveTextContent('Behind the Screen');
    expect(summary).toHaveTextContent('Goblin');
    expect(summary).toHaveTextContent('hits');
    expect(summary).toHaveTextContent('Orc');
    expect(summary).toHaveTextContent('fails');
  });

  it('renders nothing when the message carries no NPC rolls', () => {
    seedSetting(true);
    renderMessage({});
    expect(screen.queryByTestId('npc-roll-summary')).toBeNull();
  });

  it('drops malformed entries rather than printing a half line', () => {
    seedSetting(true);
    renderMessage({
      npcRollResults: [
        npcRolls[0],
        { request: { purpose: 'no result here' } },
        'not-an-entry',
        { request: { purpose: 42 }, result: { total: 10 } },
      ],
    });

    const summary = screen.getByTestId('npc-roll-summary');
    expect(summary).toHaveTextContent('Goblin');
    expect(summary).not.toHaveTextContent('no result here');
  });

  it('hides the summary when the setting is off', () => {
    seedSetting(false);
    renderMessage({ npcRollResults: npcRolls });
    expect(screen.queryByTestId('npc-roll-summary')).toBeNull();
  });

  it('shows and hides the summary live when the setting changes, without a reload', () => {
    seedSetting(true);
    renderMessage({ npcRollResults: npcRolls });
    expect(screen.getByTestId('npc-roll-summary')).toBeInTheDocument();

    act(() => {
      seedSetting(false);
      window.dispatchEvent(new Event('ir-table-settings'));
    });
    expect(screen.queryByTestId('npc-roll-summary')).toBeNull();

    act(() => {
      seedSetting(true);
      window.dispatchEvent(new Event('ir-table-settings'));
    });
    expect(screen.getByTestId('npc-roll-summary')).toBeInTheDocument();
  });
});
