import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import CampaignPreview from './CampaignPreview';

import { CampaignProvider, useCampaign } from '@/contexts/CampaignContext';

function CampaignStateSetter({ campaign }: { campaign: Record<string, unknown> }) {
  const { dispatch } = useCampaign();
  React.useEffect(() => {
    if (campaign) {
      dispatch({ type: 'UPDATE_CAMPAIGN', payload: campaign as Parameters<typeof dispatch>[0]['payload'] });
    }
  }, [campaign, dispatch]);
  return <CampaignPreview />;
}

function renderWithCampaign(campaign: Record<string, unknown>) {
  return render(
    <CampaignProvider>
      <CampaignStateSetter campaign={campaign} />
    </CampaignProvider>,
  );
}

describe('CampaignPreview', () => {
  it('renders Location row and location text when setting_details contains location', () => {
    renderWithCampaign({
      name: 'Test Campaign',
      setting_details: {
        location: 'Eldoria',
      },
    });

    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Eldoria')).toBeInTheDocument();
  });

  it('hides Location row when setting_details does not contain location', () => {
    renderWithCampaign({
      name: 'Test Campaign',
      setting_details: {},
    });

    expect(screen.queryByText('Location')).not.toBeInTheDocument();
  });

  it('hides Location row when setting_details is undefined', () => {
    renderWithCampaign({
      name: 'Test Campaign',
    });

    expect(screen.queryByText('Location')).not.toBeInTheDocument();
  });
});
