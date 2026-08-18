import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { CampaignTitleOverlay } from '../CampaignTitleOverlay';

describe('CampaignTitleOverlay', () => {
  it('renders the campaign name as a styled, image-independent heading', () => {
    render(<CampaignTitleOverlay title="The Eternal Feast" />);

    expect(screen.getByText('Campaign')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The Eternal Feast' })).toBeInTheDocument();
  });
});
