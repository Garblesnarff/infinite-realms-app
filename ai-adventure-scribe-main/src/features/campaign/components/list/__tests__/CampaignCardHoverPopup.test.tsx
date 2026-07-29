import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { CampaignCardHoverPopup } from '../CampaignCardHoverPopup';

describe('CampaignCardHoverPopup Tooltips and UX', () => {
  const mockCampaign = {
    id: 'camp-123',
    name: 'Curse of Strahd',
    description: 'A gothic horror campaign set in Barovia.',
    genre: 'horror',
    difficulty_level: 'hard',
    campaign_length: 'long',
    tone: 'dark',
  };

  it('renders action buttons with correct accessibility attributes', () => {
    render(
      <CampaignCardHoverPopup
        campaign={mockCampaign}
        isHovered={true}
        imageLoading={false}
        onPlay={vi.fn()}
        onEnter={vi.fn()}
        onDeleteClick={vi.fn()}
      />
    );

    // Verify buttons have correct aria-labels
    const playBtn = screen.getByRole('button', { name: /Play campaign: Curse of Strahd/i });
    const enterBtn = screen.getByRole('button', { name: /Enter campaign management: Curse of Strahd/i });
    const deleteBtn = screen.getByRole('button', { name: /Delete campaign: Curse of Strahd/i });

    expect(playBtn).toBeInTheDocument();
    expect(enterBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();

    // Verify buttons do NOT have native title attributes (standardizing with custom Shadcn Tooltips)
    expect(playBtn).not.toHaveAttribute('title');
    expect(enterBtn).not.toHaveAttribute('title');
    expect(deleteBtn).not.toHaveAttribute('title');
  });

  it('triggers action callbacks successfully on click', async () => {
    const handlePlay = vi.fn();
    const handleEnter = vi.fn();
    const handleDelete = vi.fn();

    render(
      <CampaignCardHoverPopup
        campaign={mockCampaign}
        isHovered={true}
        imageLoading={false}
        onPlay={handlePlay}
        onEnter={handleEnter}
        onDeleteClick={handleDelete}
      />
    );

    const user = userEvent.setup();

    const playBtn = screen.getByRole('button', { name: /Play campaign: Curse of Strahd/i });
    const enterBtn = screen.getByRole('button', { name: /Enter campaign management: Curse of Strahd/i });
    const deleteBtn = screen.getByRole('button', { name: /Delete campaign: Curse of Strahd/i });

    await user.click(playBtn);
    expect(handlePlay).toHaveBeenCalledTimes(1);

    await user.click(enterBtn);
    expect(handleEnter).toHaveBeenCalledTimes(1);

    await user.click(deleteBtn);
    expect(handleDelete).toHaveBeenCalledTimes(1);
  });
});
