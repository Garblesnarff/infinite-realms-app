import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HPMechanics } from '../../../../../../../server-bun/src/services/combat/hp-mechanics';
import {
  describeDeathSaveRollLine,
  type DeathSaveFacts,
} from '../../../../../../../shared/death-save-lines';
import { FIGHT_ROSTER, SCHOLAR } from '../../../../../../../shared/test-fixtures/engine-results';
import { DMMessage } from '../DMMessage';

import type { CombatEngineBlock } from '@/utils/combat-engine-blocks';

import {
  formatDeathSaveParts,
  formatWakeParts,
  type EngineTranscriptPart,
} from '@/services/combat/combat-outcome-transcript';

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

const STATE_SENTENCE = 'The Scholar is stable and unconscious for 3 hours (1d4).';

/** A real engine save: the server's HPMechanics.resolveDeathSave, as the dying-turn test uses it. */
const realSave = (
  current: { successes: number; failures: number },
  roll: number,
): ReturnType<typeof HPMechanics.resolveDeathSave> =>
  HPMechanics.resolveDeathSave(
    SCHOLAR.id,
    {
      currentHp: 0,
      maxHp: 7,
      tempHp: 0,
      isConscious: false,
      deathSavesSuccesses: current.successes,
      deathSavesFailures: current.failures,
    },
    roll,
  );

/**
 * The single-action block the way combat-resolution-step assembles it: the death-save parts,
 * with a rolled save's line replaced by its roll line, joined into one block; the wake parts
 * come as their own block (combat-resolution-step.ts, #2518).
 */
function blocksFor(result: Record<string, unknown>): CombatEngineBlock[] {
  const roster = FIGHT_ROSTER;
  const saves = formatDeathSaveParts(result, roster);
  const rolled = ((result.deathSaves as unknown[]) ?? []) as Array<Record<string, unknown>>;
  const saveParts: EngineTranscriptPart[] = saves.map((part, index) => {
    const save = rolled[index] as unknown as DeathSaveFacts & { roll?: number };
    const rollLine = describeDeathSaveRollLine(save);
    if (!rollLine) return part;
    const line = `⚙️ Engine: ${rollLine}`;
    return { ...part, line, card: { ...part.card, line } };
  });
  const wakeParts = formatWakeParts(result);
  const blocks: CombatEngineBlock[] = [];
  if (saveParts.length) {
    blocks.push({
      sequence: 0,
      round: 3,
      source: 'player',
      actor: SCHOLAR.name,
      lines: [saveParts.map((part) => part.line).join('\n\n')],
      cards: saveParts.map((part) => part.card),
    } as CombatEngineBlock);
  }
  if (wakeParts.length) {
    blocks.push({
      sequence: 1,
      round: 3,
      source: 'player',
      actor: SCHOLAR.name,
      lines: [wakeParts.map((part) => part.line).join('\n\n')],
      cards: wakeParts.map((part) => part.card),
    } as CombatEngineBlock);
  }
  return blocks;
}

const renderBlocks = (blocks: CombatEngineBlock[]) =>
  render(
    <DMMessage
      message={
        {
          sender: 'dm',
          text: 'The spider’s fangs close on the body.',
          context: { combatEngineBlocks: blocks },
        } as never
      }
      messageId="dm-dying"
      isFirstInGroup
      isLastInGroup
      displayContent="The spider’s fangs close on the body."
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
    />,
  );

describe('a dying hero who rolls three successes (#906)', () => {
  it('prints the stable and unconscious sentence exactly once in the transcript', () => {
    // Real engine payload: the save that makes the third success, and the wake the fight-end adds.
    const third = realSave({ successes: 2, failures: 0 }, 13);
    expect(third.isStabilized).toBe(true);
    const result = {
      deathSaves: [third],
      combatEnded: true,
      endedReason: 'player_down_stable',
      wake: [{ participantId: SCHOLAR.id, name: SCHOLAR.name, hours: 3 }],
    };
    const { container } = renderBlocks(blocksFor(result));
    const text = container.textContent ?? '';
    const count = text.split(STATE_SENTENCE).length - 1;
    // Visible evidence for the report: how many times the sentence is on screen.
    console.log('STABLE_SENTENCE_COUNT', count, JSON.stringify(text.slice(0, 600)));
    expect(count).toBe(1);
  });
});
