import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ABILITY_CHECK_ROW_FAIL,
  ABILITY_CHECK_ROW_NO_CARD,
  ABILITY_CHECK_ROW_SUCCESS,
} from '../../../../../../../shared/test-fixtures/ability-check-saves';
import { MessageRenderer } from '../MessageRenderer';

vi.mock('@/contexts/CampaignContext', () => ({
  useOptionalCampaign: () => ({ state: { campaign: { difficulty_level: 'medium' } } }),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn(), assets: [] }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));
vi.mock('../MessageMetadata', () => ({ MessageMetadata: () => null }));

/**
 * #1477: a narrative check row as the server persists it (`shared/test-fixtures/ability-check-saves.ts`).
 * The seal reads the server's `engineCards[0].badge`, never the die or the stored text.
 */
const renderRow = (row: {
  text: string;
  sender: 'player';
  context: Record<string, unknown>;
}): ReturnType<typeof render> =>
  render(
    <MessageRenderer
      message={row}
      messageId={`check-${row.text}`}
      groupIndex={0}
      msgIndex={0}
      isFirstInGroup
      isLastInGroup
      // A check row is not a player bubble (player-chat-bubble.ts), so it renders as an engine result.
      isPlayer={false}
      isDM={false}
      isCompanion={false}
      expandedMessages={new Set()}
      setExpandedMessages={vi.fn() as never}
      imageByMessage={{}}
      generatingFor={new Set()}
      genErrorByMessage={{}}
      onGenerateScene={vi.fn()}
      onOptionSelect={vi.fn()}
    />,
  );

describe('narrative check seal from the server outcome (#1477)', () => {
  beforeEach(() => {
    document.body.classList.add('ir-table-look');
    window.localStorage.clear();
  });
  afterEach(() => {
    document.body.classList.remove('ir-table-look');
  });

  it('a persisted server SUCCESS card shows a gold SUCCESS seal', () => {
    renderRow(ABILITY_CHECK_ROW_SUCCESS);
    const seal = screen.getByTestId('engine-roll-seal');
    expect(seal).toHaveTextContent('SUCCESS');
    expect(seal).toHaveAttribute('data-seal-tone', 'gold');
    expect(screen.getByTestId('engine-result-card')).toHaveAccessibleName(/SUCCESS/);
  });

  it('a persisted server FAIL card shows a red FAIL seal', () => {
    renderRow(ABILITY_CHECK_ROW_FAIL);
    const seal = screen.getByTestId('engine-roll-seal');
    expect(seal).toHaveTextContent('FAIL');
    expect(seal).toHaveAttribute('data-seal-tone', 'red');
    expect(screen.getByTestId('engine-result-card')).toHaveAccessibleName(/FAIL/);
  });

  it('the seal follows the server badge, not the client text: a text that says success on a FAIL card seals FAIL', () => {
    renderRow({ ...ABILITY_CHECK_ROW_FAIL, text: 'Athletics check: 9 (nat 4+5) success' });
    expect(screen.getByTestId('engine-roll-seal')).toHaveTextContent('FAIL');
    expect(screen.getByTestId('engine-roll-seal')).toHaveAttribute('data-seal-tone', 'red');
  });

  it('a row with no server card shows no seal and no card', () => {
    renderRow(ABILITY_CHECK_ROW_NO_CARD);
    expect(screen.queryByTestId('engine-roll-seal')).toBeNull();
    expect(screen.queryByTestId('engine-result-card')).toBeNull();
  });

  it('the seal is still there after a reload of the same persisted row', () => {
    // A reload reads the stored row back as JSON; the seal must come from that payload alone.
    const reloaded = JSON.parse(JSON.stringify(ABILITY_CHECK_ROW_SUCCESS));
    const { unmount } = renderRow(reloaded);
    expect(screen.getByTestId('engine-roll-seal')).toHaveTextContent('SUCCESS');
    unmount();
    renderRow(JSON.parse(JSON.stringify(ABILITY_CHECK_ROW_SUCCESS)));
    expect(screen.getByTestId('engine-roll-seal')).toHaveTextContent('SUCCESS');
  });
});
