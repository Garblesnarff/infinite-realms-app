import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../../../../shared/npc-engine-message';
import {
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
} from '../../../../../../../shared/test-fixtures/engine-results';
import { SystemMessage } from '../SystemMessage';


const campaign = vi.hoisted(() => ({ difficulty: 'medium' }));
vi.mock('@/contexts/CampaignContext', () => ({
  useOptionalCampaign: () => ({ state: { campaign: { difficulty_level: campaign.difficulty } } }),
}));
vi.mock('../MessageMetadata', () => ({ MessageMetadata: () => null }));

const KEPT = '⚙️ Engine: Captain Sarah Reeves turns hostile.';
const received = buildNpcEngineMessage(
  FIGHT_ROSTER.map((participant) => ({ ...participant, maxHp: 7 })), 1,
  { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id }, ENEMY_HITS_PLAYER,
);
const cards = received.context.engineCards;
const text = `${received.text}\n\n${KEPT}`;

const renderRow = () =>
  render(
    <SystemMessage
      message={{ sender: 'system', text, context: { engineCards: cards } } as never}
      isFirstInGroup
      isLastInGroup
      displayText={text}
    />,
  );

describe('system row with engine cards (#2417)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    campaign.difficulty = 'medium';
  });

  it('prints the card and keeps a line no card stands for', () => {
    renderRow();

    expect(screen.getAllByTestId('engine-result-card')).toHaveLength(1);
    expect(screen.getByText(KEPT)).toBeTruthy();
    // The line is the card's screen reader sentence once, not a second chip.
    expect(screen.getAllByText(/rolled 14 \+ 0 = 14/)).toHaveLength(1);
    expect(screen.getByTestId('engine-card-sentence').textContent).toContain('rolled 14 + 0 = 14');
  });

  it('hides the AC on Hard', () => {
    campaign.difficulty = 'hard';
    const { container } = renderRow();

    expect(container.textContent).toContain('rolled 14 + 0 = 14');
    expect(container.textContent).not.toContain('vs your AC');
    expect(container.textContent).not.toContain('AC ?');
    expect(container.textContent).not.toContain('AC 11');
  });

  it('prints plain text when there are no cards', () => {
    render(
      <SystemMessage
        message={{ sender: 'system', text: 'The door opens.' } as never}
        isFirstInGroup
        isLastInGroup
        displayText="The door opens."
      />,
    );

    expect(screen.getByText('The door opens.')).toBeTruthy();
  });
});
