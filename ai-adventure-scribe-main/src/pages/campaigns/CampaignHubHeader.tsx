import { Users } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

interface CampaignHubHeaderProps {
  campaignId: string;
  campaignName: string;
  onStartNewSession: () => void;
}

export const CampaignHubHeader: React.FC<CampaignHubHeaderProps> = ({
  campaignId,
  campaignName,
  onStartNewSession,
}) => {
  return (
    <div className="mb-6">
      <div className="glass-strong rounded-2xl p-6 hover-lift">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-infinite-purple to-infinite-gold flex items-center justify-center shadow-lg">
                <span className="text-xl">⚔️</span>
              </div>
              <div>
                <h1 className="ir-display text-3xl font-semibold bg-gradient-to-r from-infinite-purple to-infinite-gold bg-clip-text text-transparent">
                  {campaignName}
                </h1>
                <p className="text-muted-foreground">Epic Campaign Adventure</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              asChild
              className="bg-gradient-to-r from-infinite-purple to-infinite-purple-dark hover:from-infinite-purple-dark hover:to-infinite-purple text-white shadow-lg hover:shadow-xl transition-all duration-300"
            >
              <Link to={`/app/campaigns/${campaignId}/characters`}>
                <Users className="w-4 h-4 mr-2" />
                Manage Characters
              </Link>
            </Button>
            <Button
              variant="outline"
              className="border-infinite-gold text-infinite-gold hover:bg-infinite-gold/10"
              onClick={onStartNewSession}
            >
              <span className="mr-2">+</span>
              New Session
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
