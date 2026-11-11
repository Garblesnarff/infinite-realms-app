import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attackAction,
  ENEMY_FAILS_SAVE,
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  PLAYER_HITS_ENEMY,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../../../../../shared/test-fixtures/engine-results';
import { DMMessage } from '../DMMessage';
import { MessageRenderer } from '../MessageRenderer';
import { SystemMessage } from '../SystemMessage';

import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';
import { engineCardAriaLabel, initiativeCard } from '@/services/combat/engine-result-card';

const campaign = vi.hoisted(() => ({ difficulty: 'medium' as string | undefined }));

vi.mock('@/contexts/CampaignContext', () => ({
  useOptionalCampaign: () => ({ state: { campaign: { difficulty_level: campaign.difficulty } } }),
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

/** The row useMessageQueue writes for a narrative check: text plus intent, no diceRoll. */
const persistedCheck = {
  text: 'Athletics check: 17 (nat 12+5) success',
  sender: 'player' as const,
  context: {
    location: null,
    emotion: null,
    intent: 'dice_roll',
    rollRequestId: '11111111-1111-4111-8111-111111111111:roll:0',
    handouts: null,
    combat_transition: null,
    scene_spec: false,
    combat_engine_blocks: null,
    combat_ended: false,
    narration_segments: null,
  },
};

const expectCardVerdict = (token: RegExp | string) => {
  expect(screen.getByTestId('engine-result-card')).toHaveAccessibleName(
    expect.stringMatching(token),
  );
  expect(screen.getByTestId('engine-roll-seal').closest('[aria-hidden="true"]')).toBeTruthy();
};

describe('result seal on the mounted card (#1457)', () => {
  beforeEach(() => {
    document.body.classList.add('ir-table-look');
    window.localStorage.clear();
    campaign.difficulty = 'medium';
  });
  afterEach(() => {
    document.body.classList.remove('ir-table-look');
  });

  it('a persisted ability check has no structured outcome, so it has no seal', () => {
    render(
      <MessageRenderer
        message={persistedCheck}
        messageId="check-1"
        groupIndex={0}
        msgIndex={0}
        isFirstInGroup
        isLastInGroup
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
    expect(screen.getByText(persistedCheck.text)).toBeTruthy();
    expect(screen.queryByTestId('engine-roll-seal')).toBeNull();
    expect(screen.queryByTestId('engine-result-card')).toBeNull();
  });

  it('seals a failed save with the engine line token', () => {
    const parts = formatCombatEngineParts(
      spellAction(SCHOLAR, REEVES),
      ENEMY_FAILS_SAVE,
      FIGHT_ROSTER,
    );
    const card = parts[0].card;
    render(
      <SystemMessage
        message={{
          sender: 'system',
          text: card.line,
          context: { engineCards: [card] },
        }}
        isFirstInGroup
        isLastInGroup
        displayText={card.line}
      />,
    );
    const seal = screen.getByTestId('engine-roll-seal');
    expect(seal).toHaveTextContent(card.badge?.word ?? '');
    expect(seal).toHaveAttribute('data-seal-tone', 'gold');
    expectCardVerdict(/FAIL/);
    expect(screen.getByTestId('engine-result-card')).toHaveAccessibleName(
      engineCardAriaLabel(card, true),
    );
  });

  it('seals a player attack with the card badge word', () => {
    const parts = formatCombatEngineParts(
      attackAction(SCHOLAR, REEVES),
      PLAYER_HITS_ENEMY,
      FIGHT_ROSTER,
    );
    const card = parts[0].card;
    render(
      <DMMessage
        message={{
          sender: 'dm',
          text: 'Steel rings.',
          context: {
            combatEngineBlocks: [
              {
                sequence: 0,
                round: 1,
                source: 'player',
                actor: SCHOLAR.name,
                lines: [card.line],
                cards: [card],
              },
            ],
          },
        }}
        messageId="dm-attack"
        isFirstInGroup
        isLastInGroup
        displayContent="Steel rings."
        isExpanded={false}
        onToggleExpanded={vi.fn()}
        isGeneratingImage={false}
        onGenerateImage={vi.fn()}
      />,
    );
    const seal = screen.getByTestId('engine-roll-seal');
    expect(seal).toHaveTextContent('HIT');
    expect(seal).toHaveAttribute('data-seal-tone', 'gold');
    expect(card.badge?.word).toBe('HIT');
    expectCardVerdict(/HIT/);
  });

  it('seals initiative with the seated player total', () => {
    const card = initiativeCard(
      [
        { id: REEVES.id, name: REEVES.name, initiative: 4, turnOrder: 1, participantType: 'enemy' },
        {
          id: SCHOLAR.id,
          name: SCHOLAR.name,
          initiative: 9,
          turnOrder: 0,
          participantType: 'player',
        },
      ],
      '⚙️ Engine: Initiative — You: 9 + 0 = 9. Captain Sarah Reeves: 4 + 0 = 4.',
    );
    expect(card).not.toBeNull();
    render(
      <SystemMessage
        message={{
          sender: 'system',
          text: card!.line,
          context: { engineCards: [card!] },
        }}
        isFirstInGroup
        isLastInGroup
        displayText={card!.line}
      />,
    );
    const seal = screen.getByTestId('engine-roll-seal');
    expect(seal).toHaveTextContent('9');
    expect(seal).toHaveAttribute('data-seal-tone', 'slate');
    expectCardVerdict(/\b9\b/);
  });

  it('seals an NPC hit with the engine badge word and the enemy tone', () => {
    const parts = formatCombatEngineParts(
      attackAction(REEVES, SCHOLAR),
      ENEMY_HITS_PLAYER,
      FIGHT_ROSTER,
      { targetHp: true, targetMaxHp: 7 },
    );
    const card = parts[0].card;
    render(
      <SystemMessage
        message={{
          sender: 'system',
          text: card.line,
          context: { intent: 'combat_npc_result', engineCards: [card] },
        }}
        isFirstInGroup
        isLastInGroup
        displayText={card.line}
      />,
    );
    const seal = screen.getByTestId('engine-roll-seal');
    expect(seal).toHaveTextContent(card.badge?.word ?? '');
    expect(seal).toHaveAttribute('data-seal-tone', 'red');
    expectCardVerdict(/HIT/);
  });
});
