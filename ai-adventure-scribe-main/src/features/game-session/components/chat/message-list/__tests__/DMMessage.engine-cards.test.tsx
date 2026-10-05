import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attackAction,
  ENEMY_FAILS_SAVE,
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  PLAYER_HITS_ENEMY,
  PLAYER_MISSES_ENEMY,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../../../../../shared/test-fixtures/engine-results';
import { DMMessage } from '../DMMessage';
import { MessageRenderer } from '../MessageRenderer';

import type { CombatEngineBlock } from '@/utils/combat-engine-blocks';

import { TargetNumbersToggle } from '@/features/game-session/components/game/game-content/TargetNumbersToggle';
import {
  formatCombatEngineParts,
  formatRefusedSpellPart,
} from '@/services/combat/combat-outcome-transcript';

const campaign = vi.hoisted(() => ({ difficulty: 'medium' as string | undefined }));

vi.mock('@/contexts/CampaignContext', () => ({
  useOptionalCampaign: () => ({ state: { campaign: { difficulty_level: campaign.difficulty } } }),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn() }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));

const ON_YOU = { targetHp: true, targetMaxHp: 7 };

/** The one block a turn prints, built by the real producers: your swing, then the enemy's. */
const blockOf = () => {
  const yours = formatCombatEngineParts(
    attackAction(SCHOLAR, REEVES),
    PLAYER_HITS_ENEMY,
    FIGHT_ROSTER,
  );
  const theirs = formatCombatEngineParts(
    attackAction(REEVES, SCHOLAR),
    ENEMY_HITS_PLAYER,
    FIGHT_ROSTER,
    ON_YOU,
  );
  const save = formatCombatEngineParts(
    spellAction(SCHOLAR, REEVES),
    ENEMY_FAILS_SAVE,
    FIGHT_ROSTER,
  );
  const miss = formatCombatEngineParts(
    attackAction(SCHOLAR, REEVES),
    PLAYER_MISSES_ENEMY,
    FIGHT_ROSTER,
  );
  const refused = formatRefusedSpellPart(
    SCHOLAR.id,
    'Chill Touch',
    'it is not your turn',
    FIGHT_ROSTER,
  );
  const parts = [...yours, ...theirs, ...save, ...miss, refused];
  return {
    sequence: 0,
    round: 1,
    source: 'player' as const,
    actor: SCHOLAR.name,
    lines: parts.map((part) => part.line),
    cards: parts.map((part) => part.card),
  };
};

const renderMessage = (blocks: CombatEngineBlock[] = [blockOf()]) =>
  render(
    <>
      <TargetNumbersToggle />
      <DMMessage
        message={{ sender: 'dm', text: 'Steel rings.', context: { combatEngineBlocks: blocks } }}
        messageId="dm-1"
        isFirstInGroup
        isLastInGroup
        displayContent="Steel rings."
        isExpanded={false}
        onToggleExpanded={vi.fn()}
        isGeneratingImage={false}
        onGenerateImage={vi.fn()}
      />
    </>,
  );

const cards = () => screen.getAllByTestId('engine-result-card');

describe('engine result cards in the chat (#2417)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    campaign.difficulty = 'medium';
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('prints one card for each engine result and no plain chip for it', () => {
    renderMessage();

    expect(cards()).toHaveLength(5);
    expect(screen.queryByText(/⚙️/)).toBeNull();
    expect(screen.getAllByTestId('engine-card-badge').map((node) => node.textContent)).toEqual([
      'HIT',
      'HIT',
      'TARGET FAILED',
      'MISS',
      'REFUSED',
    ]);
  });

  it('colours by who it helps: gold for your hit, red for theirs, grey for a miss or a refusal', () => {
    renderMessage();

    expect(screen.getAllByTestId('engine-card-badge').map((node) => node.dataset.tone)).toEqual([
      'gold',
      'red',
      'gold',
      'grey',
      'grey',
    ]);
    expect(cards().map((card) => card.dataset.side)).toEqual([
      'party',
      'enemy',
      'party',
      'party',
      'party',
    ]);
  });

  it('reads each card as one sentence: the engine line is its screen reader text', () => {
    renderMessage();

    expect(
      screen.getByText(
        'The Scholar cast Acid Splash at Captain Sarah Reeves — DEX save 6 vs DC 14 — FAIL. 2 acid damage. Captain Sarah Reeves is now at 9 HP.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11 against The Scholar with Longsword — HIT. 3 slashing damage. The Scholar is now at 4 HP and is wounded.',
      ),
    ).toBeTruthy();
  });

  it('puts the sentence in page text a screen reader reads, not in a hidden or label-only node', () => {
    renderMessage();

    for (const sentence of screen.getAllByTestId('engine-card-sentence')) {
      expect(sentence.textContent?.length).toBeGreaterThan(20);
      expect(sentence.className).toContain('sr-only');
      expect(sentence.closest('[aria-hidden="true"]')).toBeNull();
    }
    for (const card of cards()) {
      expect(card.hasAttribute('aria-label')).toBe(false);
      expect(card.querySelector(':scope > [aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('shows the player their HP when hit: HP 4 of 7, −3', () => {
    renderMessage();

    const hp = screen.getByTestId('engine-card-hp');
    expect(hp.textContent).toContain('The Scholar · HP 4 of 7');
    expect(hp.textContent).toContain('−3');
  });

  describe('Show target numbers', () => {
    it.each(['easy', 'medium'])('shows the AC and the DC on %s', (difficulty) => {
      campaign.difficulty = difficulty;
      const { container } = renderMessage();

      expect(container.textContent).toContain('vs your AC 11');
      expect(container.textContent).toContain('DEX save 6 vs DC 14');
    });

    it('hides the AC and the DC on hard, in the text and for a screen reader', () => {
      campaign.difficulty = 'hard';
      const { container } = renderMessage();

      expect(container.textContent).toContain('d20 14 + 0 = 14');
      expect(container.textContent).not.toContain('vs your AC');
      expect(container.textContent).not.toContain('AC ?');
      expect(container.textContent).toContain('DEX save 6');
      expect(container.textContent).not.toContain('AC 11');
      expect(container.textContent).not.toContain('DC');
      for (const card of cards()) {
        const label = within(card).getByTestId('engine-card-sentence').textContent ?? '';
        expect(label).not.toContain('AC 11');
        expect(label).not.toContain('DC 14');
      }
    });

    it('follows the player once they choose, whatever the difficulty says', () => {
      campaign.difficulty = 'hard';
      const { container } = renderMessage();
      expect(container.textContent).not.toContain('DC 14');

      fireEvent.click(screen.getByRole('button', { name: /show target numbers/i }));

      expect(container.textContent).toContain('DEX save 6 vs DC 14');
      expect(
        within(container)
          .getByRole('button', { name: /show target numbers/i })
          .getAttribute('aria-pressed'),
      ).toBe('true');
    });
  });

  it('survives a saved block whose cards are not a list', () => {
    renderMessage([{ ...blockOf(), cards: 'oops' as unknown as CombatEngineBlock['cards'] }]);

    expect(screen.queryAllByTestId('engine-result-card')).toHaveLength(0);
    expect(screen.getAllByText(/vs AC/).length).toBeGreaterThan(0);
  });

  it('keeps the plain chip for a line no card stands for, such as a message saved before cards', () => {
    renderMessage([
      {
        sequence: 0,
        round: 1,
        source: 'npc',
        actor: REEVES.name,
        lines: [
          '⚙️ Engine: The Scholar rolled 14 + 0 = 14 vs AC 11 against Captain Sarah Reeves — HIT. 3 damage.',
        ],
      },
    ]);

    expect(screen.queryAllByTestId('engine-result-card')).toHaveLength(0);
    expect(screen.getByText(/rolled 14 \+ 0 = 14 vs AC 11/)).toBeTruthy();
  });

  it('renders the live roll result beside a persisted DM reply and keeps the Engine line visible', () => {
    const rollResultResponse = {
      formula: '2d20kh1+1',
      count: 2,
      dieType: 20,
      modifier: 1,
      advantage: true,
      disadvantage: false,
      total: 16,
      naturalRoll: 15,
      timestamp: '2026-10-04T14:39:00.000Z',
    };
    const persistedDmReplyRow = {
      id: 'dm-reply-2586',
      speaker_type: 'dm' as const,
      message: 'The slope gives way beneath your feet.',
      context: { combatEngineBlocks: [blockOf()] },
      images: [],
      timestamp: '2026-10-04T14:39:01.000Z',
      sequence_number: 7,
    };

    const persistedChatMessage = {
      id: persistedDmReplyRow.id,
      text: persistedDmReplyRow.message,
      sender: persistedDmReplyRow.speaker_type,
      timestamp: persistedDmReplyRow.timestamp,
      context: persistedDmReplyRow.context,
    };

    expect(() =>
      render(
        <>
          <MessageRenderer
            message={{
              text: 'Acrobatics check: 16',
              sender: 'player',
              context: { intent: 'dice_roll', diceRoll: rollResultResponse },
            }}
            messageId="roll-result-2586"
            groupIndex={0}
            msgIndex={0}
            isFirstInGroup
            isLastInGroup
            isPlayer
            isDM={false}
            isCompanion={false}
            expandedMessages={new Set()}
            setExpandedMessages={vi.fn()}
            imageByMessage={{}}
            generatingFor={new Set()}
            genErrorByMessage={{}}
            onGenerateScene={vi.fn().mockResolvedValue(undefined)}
            onOptionSelect={vi.fn().mockResolvedValue(undefined)}
          />
          <MessageRenderer
            message={persistedChatMessage}
            messageId={persistedDmReplyRow.id}
            groupIndex={0}
            msgIndex={1}
            isFirstInGroup={false}
            isLastInGroup
            isPlayer={false}
            isDM
            isCompanion={false}
            expandedMessages={new Set()}
            setExpandedMessages={vi.fn()}
            imageByMessage={{}}
            generatingFor={new Set()}
            genErrorByMessage={{}}
            onGenerateScene={vi.fn().mockResolvedValue(undefined)}
            onOptionSelect={vi.fn().mockResolvedValue(undefined)}
          />
        </>,
      ),
    ).not.toThrow();

    expect(
      screen.getByText(
        'Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11 against The Scholar with Longsword — HIT. 3 slashing damage. The Scholar is now at 4 HP and is wounded.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Kept: \[15\]/)).toBeTruthy();
  });
});
