import { Compass, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { isCustomCampaignsEnabled } from '@/config/featureFlags';

/**
 * EmptyState component
 * Displayed when no campaigns are available
 * Offers the wizard when custom campaigns are enabled, otherwise the
 * pre-built campaigns
 */
const EmptyState = () => {
  const navigate = useNavigate();

  return (
    <div className="text-center py-12 ir-panel rounded-lg p-8">
      <h3 className="text-2xl font-semibold mb-2 ir-display text-infinite-gold">
        No Campaigns Found
      </h3>
      <p className="text-muted-foreground mb-6">
        {isCustomCampaignsEnabled()
          ? "You haven't created any campaigns yet. Your tales await."
          : "You haven't started a campaign yet. Explore a pre-built one to begin."}
      </p>
      {/*
        #2192: the wizard is hidden from beta users while the flag is off.
        Existing campaigns stay reachable through the campaign list; only this
        wizard entry point is gated, and the pre-built campaigns are offered
        in its place so the empty list still has a next step.
      */}
      <div className="flex items-center justify-center">
        {isCustomCampaignsEnabled() ? (
          <Button
            onClick={() => navigate('/app/campaigns/create')}
            className="flex items-center gap-2 bg-infinite-gold text-infinite-dark"
          >
            <Plus className="w-4 h-4" />
            Create Campaign
          </Button>
        ) : (
          <Button
            onClick={() => navigate('/explore')}
            className="flex items-center gap-2 bg-infinite-gold text-infinite-dark"
          >
            <Compass className="w-4 h-4" />
            Explore Pre-Built Campaigns
          </Button>
        )}
      </div>
    </div>
  );
};

export default EmptyState;
