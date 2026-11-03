import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildSavedPlaythroughs, loadPlaythroughCharacters } from '../saved-playthroughs';
import { SavedPlaythroughList } from '../SavedPlaythroughList';

const listCharacters = vi.hoisted(() =>
  vi.fn(async function (this: { listCharacters?: unknown }, campaignId: string) {
    if (campaignId !== 'camp-9' || typeof this.listCharacters !== 'function') {
      throw new Error('listCharacters was called without its client');
    }
    return [
      {
        id: 'hero-1',
        stats: { current_hit_points: 12, max_hit_points: 20, vital_state: 'alive' },
      },
    ];
  }),
);

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { listCharacters },
}));

const NOW = Date.parse('2026-11-03T12:00:00.000Z');
const hoursAgo = (hours: number): string => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

describe('Choose a saved playthrough (#1349)', () => {
  it('shows three saved runs with hero, HP, latest session, and last played, newest first', () => {
    const rows = buildSavedPlaythroughs({
      starterCampaignId: 'c1',
      heroName: 'Bram',
      campaignId: 'camp-9',
      sessions: [
        {
          starter_campaign_id: 'c1',
          character_id: 'older-copy',
          character: { name: 'Bram' },
          status: 'active',
          session_number: 1,
          updated_at: hoursAgo(24 * 10),
        },
        {
          starter_campaign_id: 'c1',
          character_id: 'fallen-copy',
          character: { name: 'Bram' },
          status: 'completed',
          session_number: 2,
          updated_at: hoursAgo(24 * 3),
        },
        {
          starter_campaign_id: 'c1',
          character_id: 'newest-copy',
          character: { name: 'Bram' },
          status: 'completed',
          session_number: 2,
          updated_at: hoursAgo(24 * 5),
        },
        {
          starter_campaign_id: 'c1',
          character_id: 'newest-copy',
          character: { name: 'Bram' },
          status: 'active',
          session_number: 4,
          updated_at: hoursAgo(2),
        },
      ],
      characters: [
        {
          id: 'newest-copy',
          stats: { current_hit_points: 12, max_hit_points: 20, vital_state: 'alive' },
        },
        {
          id: 'fallen-copy',
          character_stats: [{ current_hit_points: 0, max_hit_points: 18, vital_state: 'dead' }],
        },
        {
          id: 'older-copy',
          stats: { current_hit_points: 30, max_hit_points: 30, vital_state: 'stable' },
        },
      ],
    });

    const onChoose = vi.fn();
    render(<SavedPlaythroughList rows={rows} now={NOW} onChoose={onChoose} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent('Bram');
    expect(buttons[0]).toHaveTextContent('HP 12/20');
    expect(buttons[0]).toHaveTextContent('Session 4');
    expect(buttons[0]).toHaveTextContent('last played 2 hours ago');
    expect(buttons[0]).not.toHaveTextContent('Finished');
    expect(buttons[0]).not.toHaveTextContent('Fallen');

    expect(buttons[1]).toHaveTextContent('HP 0/18');
    expect(buttons[1]).toHaveTextContent('Session 2');
    expect(buttons[1]).toHaveTextContent('last played 3 days ago');
    expect(buttons[1]).toHaveTextContent('Finished');
    expect(buttons[1]).toHaveTextContent('Fallen');

    expect(buttons[2]).toHaveTextContent('HP 30/30');
    expect(buttons[2]).toHaveTextContent('Session 1');
    expect(buttons[2]).toHaveTextContent('last played 10 days ago');
    expect(buttons[2]).not.toHaveTextContent('Finished');
    expect(buttons[2]).not.toHaveTextContent('Fallen');
  });

  it('puts HP from listCharacters onto the row', async () => {
    const characters = await loadPlaythroughCharacters('camp-9');
    const rows = buildSavedPlaythroughs({
      starterCampaignId: 'c1',
      heroName: 'Bram',
      campaignId: 'camp-9',
      sessions: [
        {
          starter_campaign_id: 'c1',
          character_id: 'hero-1',
          character: { name: 'Bram' },
          status: 'active',
          session_number: 1,
          updated_at: hoursAgo(1),
        },
      ],
      characters,
    });

    expect(listCharacters).toHaveBeenCalledWith('camp-9');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hpCurrent: 12, hpMax: 20, fallen: false });
    render(<SavedPlaythroughList rows={rows} now={NOW} onChoose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /HP 12\/20/ })).toBeInTheDocument();
  });
});
