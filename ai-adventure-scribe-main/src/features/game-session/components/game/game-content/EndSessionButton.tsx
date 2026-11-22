import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { userDataApi } from '@/services/user-data-api';

export interface EndSessionTarget {
  campaignId: string | null;
  characterId: string | null;
  starterCampaignId: string | null;
}

function buildEndSessionChoiceUrl({
  campaignId,
  characterId,
  starterCampaignId,
}: EndSessionTarget): string {
  if (campaignId && characterId) {
    const params = new URLSearchParams({ character: characterId });
    if (starterCampaignId) params.set('starterCampaign', starterCampaignId);
    return `/app/game/${campaignId}?${params.toString()}`;
  }
  return campaignId ? `/app/campaigns/${campaignId}` : '/app';
}

export function EndSessionButton({
  sessionId,
  campaignId,
  characterId,
  starterCampaignId,
}: {
  sessionId: string;
  campaignId: string | null;
  characterId: string | null;
  starterCampaignId: string | null;
}): React.ReactElement {
  const navigate = useNavigate();
  const [ending, setEnding] = React.useState(false);
  const [error, setError] = React.useState(false);

  async function endSession(): Promise<void> {
    if (ending) return;
    setEnding(true);
    setError(false);
    try {
      await userDataApi.completeSession(sessionId);
      navigate(buildEndSessionChoiceUrl({ campaignId, characterId, starterCampaignId }), {
        state: { sessionEnded: true },
      });
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
        disabled={ending}
        onClick={() => void endSession()}
      >
        {ending ? 'Ending session…' : 'End session'}
      </Button>
      {error && <span role="alert">Could not end session. Please try again.</span>}
    </>
  );
}
