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
import { formatDiceRoll } from '../utils/dice-roll-formatter';

import type { DiceRollRequest } from '@/types/combat';

import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';
import { initiativeCard } from '@/services/combat/engine-result-card';
import { outcomeForRoll } from '@/services/dice/roll-outcome';

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

const rollOf = (
  requestType: DiceRollRequest['requestType'],
  naturalRoll: number,
  modifier: number,
  target: { dc?: number; ac?: number },
): DiceRollRequest => ({
  id: 'roll-1457',
  requestType,
  description: requestType === 'skill_check' ? 'Athletics check' : 'Wisdom saving throw',
  rollConfig: { dieType: 20, count: 1, modifier },
  timestamp: new Date('2026-11-08T00:00:00Z'),
  status: 'completed',
  ...target,
  result: {
    dieType: 20,
    count: 1,
    modifier,
    results: [naturalRoll],
    keptResults: [naturalRoll],
    total: naturalRoll + modifier,
    naturalRoll,
    critical: naturalRoll === 20,
  },
});

const renderCheck = (roll: DiceRollRequest) => {
  const outcome = outcomeForRoll(roll);
  const verdict =
    outcome?.targetType === 'dc' ? (outcome.success ? 'SUCCESS' : 'FAILED') : undefined;
  render(
    <MessageRenderer
      message={{
        text: formatDiceRoll(roll),
        sender: 'player',
        context: {
          intent: 'dice_roll',
          diceRoll: {
            formula: '1d20+5',
            count: 1,
            dieType: 20,
            modifier: roll.rollConfig.modifier,
            advantage: false,
            disadvantage: false,
            results: roll.result?.results,
            total: roll.result?.total ?? 0,
            naturalRoll: roll.result?.naturalRoll,
            requestType: roll.requestType,
            description: roll.description,
            dc: roll.dc,
            success: outcome?.success,
            verdict,
            timestamp: '2026-11-08T00:00:00.000Z',
          },
        },
      }}
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
  return verdict;
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

  it('gives an ability check a result card whose seal is the stored verdict', () => {
    const roll = rollOf('skill_check', 12, 5, { dc: 12 });
    const verdict = renderCheck(roll);
    expect(verdict).toBe('SUCCESS');
    expect(screen.getByTestId('engine-line')).toBeTruthy();
    const seal = screen.getByTestId('engine-roll-seal');
    expect(seal).toHaveTextContent('SUCCESS');
    expect(seal).toHaveAttribute('data-seal-tone', 'gold');
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
  });
});
