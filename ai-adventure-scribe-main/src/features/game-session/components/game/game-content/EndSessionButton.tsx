import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useStarterCampaigns } from '@/hooks/use-starter-campaigns';
import { userDataApi } from '@/services/user-data-api';

export function EndSessionButton({
  sessionId,
  campaignId,
  starterCampaignId,
}: {
  sessionId: string;
  campaignId: string | null;
  starterCampaignId: string | null;
}): React.ReactElement {
  const navigate = useNavigate();
  const { campaigns, isLoading } = useStarterCampaigns();
  const [ending, setEnding] = React.useState(false);
  const [error, setError] = React.useState(false);
  const slug = campaigns.find((campaign) => campaign.id === starterCampaignId)?.slug;

  async function endSession(): Promise<void> {
    if (ending) return;
    setEnding(true);
    setError(false);
    try {
      await userDataApi.completeSession(sessionId);
      navigate(slug ? `/explore/${slug}` : `/app/campaigns/${campaignId}`);
    } catch {
      setError(true);
      setEnding(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={ending || (Boolean(starterCampaignId) && isLoading)}
        onClick={() => void endSession()}
      >
        {ending ? 'Ending session…' : 'End session'}
      </Button>
      {error && <span role="alert">Could not end session. Please try again.</span>}
    </>
  );
}
