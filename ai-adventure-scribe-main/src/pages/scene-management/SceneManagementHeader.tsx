import { ArrowLeft } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';

interface SceneManagementHeaderProps {
  campaignName: string | undefined;
  showTitleRow: boolean;
  onNavigateCampaigns: () => void;
  onNavigateCampaign: () => void;
}

export const SceneManagementHeader: React.FC<SceneManagementHeaderProps> = ({
  campaignName,
  showTitleRow,
  onNavigateCampaigns,
  onNavigateCampaign,
}) => (
  <div className="mb-6">
    <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
      <button onClick={onNavigateCampaigns} className="hover:text-foreground transition-colors">
        Campaigns
      </button>
      <span>/</span>
      <button onClick={onNavigateCampaign} className="hover:text-foreground transition-colors">
        {campaignName || 'Campaign'}
      </button>
      <span>/</span>
      <span className="text-foreground font-medium">Scenes</span>
    </nav>

    {showTitleRow && (
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-infinite-purple to-electricCyan mb-2">
            Scene Management
          </h1>
          <p className="text-muted-foreground">
            Create and manage battle maps and exploration scenes for your campaign
          </p>
        </div>
        <Button onClick={onNavigateCampaign} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Campaign
        </Button>
      </div>
    )}
  </div>
);
