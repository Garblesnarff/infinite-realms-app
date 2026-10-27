import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import EnemyCard from '../EnemyCard';

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: {
      activeEncounter: {
        participants: [
          {
            id: 'goblin-1',
            name: 'Goblin',
            displayName: 'Goblin',
            participantType: 'monster',
            currentHitPoints: 7,
            maxHitPoints: 7,
            armorClass: 13,
            conditions: [],
            monsterData: { challengeRating: '1/4', type: 'humanoid', alignment: 'neutral evil' },
          },
        ],
      },
    },
  }),
}));

vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAssetImageUrl: () => null }),
}));

describe('EnemyCard accessibility', () => {
  it('keeps the visible target action in the accessible name and activates by keyboard', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<EnemyCard enemyId="goblin-1" onSelect={onSelect} />);

    const targetButton = screen.getByRole('button', { name: 'Select target: Goblin' });
    expect(targetButton).toHaveAttribute('aria-pressed', 'false');

    await user.tab();
    expect(document.activeElement).toBe(targetButton);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the selected visible action in the accessible name', () => {
    render(<EnemyCard enemyId="goblin-1" isSelected onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Target selected: Goblin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
