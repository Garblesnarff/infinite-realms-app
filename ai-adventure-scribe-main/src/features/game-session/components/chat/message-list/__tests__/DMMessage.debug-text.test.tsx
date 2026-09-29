import { render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';

vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn() }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));

const HIT_LINE =
  '⚙️ Engine: The Veteran rolled 14 + 5 = 19 vs AC 12 against Goblin — HIT. 8 damage.';
const PLAIN_LINE = '⚙️ Engine: The Goblin is prone.';

const renderMessage = (
  text: string,
  context: Record<string, unknown> = {},
): ReturnType<typeof render> =>
  render(
    <DMMessage
      message={{ sender: 'dm', text, context }}
      messageId="dm-1"
      isFirstInGroup
      isLastInGroup
      displayContent={text}
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
    />,
  );

const engineLabels = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('span'))
    .map((node) => node.textContent?.trim().toLowerCase())
    .filter((text): text is string => text === 'engine');

describe('DMMessage debug text (#2256)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('mood word', () => {
    const context = { emotion: 'neutral', location: 'The Old Mill' };

    it('is absent when DEV is false, while the location stays', () => {
      vi.stubEnv('DEV', false);
      const { container } = renderMessage('The mill creaks.', context);

      expect(container.textContent).not.toContain('neutral');
      expect(container.querySelector('[aria-label="mood"]')).toBeNull();
      expect(container.textContent).toContain('The Old Mill');
    });

    it('is present when DEV is true', () => {
      vi.stubEnv('DEV', true);
      const { container } = renderMessage('The mill creaks.', context);

      expect(container.textContent).toContain('neutral');
      expect(container.querySelector('[aria-label="mood"]')).not.toBeNull();
    });

    it('leaves no empty metadata rule under the message when there is only a mood and DEV is false', () => {
      vi.stubEnv('DEV', false);
      const { container } = renderMessage('The mill creaks.', { emotion: 'neutral' });

      expect(container.querySelector('.border-t')).toBeNull();
    });
  });

  describe('Engine label', () => {
    it('prints once for a legacy message with one engine line, and never twice in a row', () => {
      const { container } = renderMessage(`${PLAIN_LINE}\n\nThe goblin blinks.`);

      expect(engineLabels(container)).toHaveLength(1);
      expect(container.textContent).not.toMatch(/engine\s*engine/i);
      expect(container.textContent).toContain('The Goblin is prone.');
    });

    it('prints once for several engine lines in one message', () => {
      const { container } = renderMessage(
        `${HIT_LINE}\n${PLAIN_LINE}\n${PLAIN_LINE.replace('prone', 'dazed')}\n\nOk.`,
      );

      expect(engineLabels(container)).toHaveLength(1);
      expect(container.textContent).not.toMatch(/engine\s*engine/i);
    });

    it('prints once per combat block: one block, then two blocks', () => {
      const block = (sequence: number, lines: string[]): Record<string, unknown> => ({
        sequence,
        round: 1,
        source: 'player',
        lines,
      });

      const one = renderMessage('Steel rings.', {
        combatEngineBlocks: [block(0, [HIT_LINE, PLAIN_LINE])],
      });
      expect(engineLabels(one.container)).toHaveLength(1);
      expect(one.container.textContent).not.toMatch(/engine\s*engine/i);
      one.unmount();

      const two = renderMessage('Steel rings.', {
        combatEngineBlocks: [block(0, [HIT_LINE, PLAIN_LINE]), block(1, [PLAIN_LINE, PLAIN_LINE])],
      });
      expect(engineLabels(two.container)).toHaveLength(2);
      expect(two.container.textContent).not.toMatch(/engine\s*engine/i);
      expect(two.container.querySelectorAll('[data-testid="combat-engine-block"]')).toHaveLength(2);
    });

    it('keeps every engine line readable when the label is shown only once', () => {
      const { container } = renderMessage('Steel rings.', {
        combatEngineBlocks: [
          { sequence: 0, round: 2, source: 'npc', lines: [HIT_LINE, PLAIN_LINE, PLAIN_LINE] },
        ],
      });

      expect(container.textContent).toContain('The Veteran rolled 14 + 5 = 19');
      expect(container.textContent?.match(/The Goblin is prone\./g)).toHaveLength(2);
    });
  });
});
