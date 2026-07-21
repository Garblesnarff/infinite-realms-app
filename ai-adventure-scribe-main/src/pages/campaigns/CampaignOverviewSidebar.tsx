import React from 'react';

import { Badge } from '@/components/ui/badge';
import { isMultiplayerInvitesEnabled } from '@/config/featureFlags';

interface CampaignOverviewSidebarProps {
  hasActiveSession: boolean;
  isLoadingActiveSession: boolean;
  onResumeSession: () => void;
  onStartNewSession?: () => void;
}

export const CampaignOverviewSidebar: React.FC<CampaignOverviewSidebarProps> = ({
  hasActiveSession,
  isLoadingActiveSession,
  onResumeSession,
  onStartNewSession,
}) => {
  return (
    <div className="space-y-6">
      <div className="glass-strong rounded-2xl p-6 hover-lift">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-foreground">
          <span className="w-2 h-2 rounded-full bg-infinite-gold"></span>
          Campaign Details
        </h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center py-2 border-b border-border">
            <span className="text-muted-foreground font-medium">Status</span>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              Active
            </Badge>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-border">
            <span className="text-muted-foreground font-medium">Created</span>
            <span className="text-foreground font-semibold">Recently</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-muted-foreground font-medium">Players</span>
            <span className="text-foreground font-semibold">0 / 6</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="glass-strong rounded-2xl p-6 hover-lift">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-foreground">
          <span className="w-2 h-2 rounded-full bg-infinite-teal"></span>
          Quick Actions
        </h3>
        <div className="space-y-3">
          {/* Resume Session button - shows if active session exists */}
          {hasActiveSession && (
            <button
              onClick={onResumeSession}
              disabled={isLoadingActiveSession}
              className="w-full px-4 py-3 bg-infinite-teal text-white rounded-lg hover:bg-infinite-teal/90 transition-all duration-300 hover-lift font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Resume Session
            </button>
          )}
          <button
            onClick={() => onStartNewSession?.()}
            className="w-full px-4 py-3 bg-infinite-purple text-white rounded-lg hover:bg-infinite-purple/90 transition-all duration-300 hover-lift font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start New Session
          </button>
          {isMultiplayerInvitesEnabled() && (
            <button className="w-full px-4 py-3 border-2 border-infinite-gold text-infinite-gold rounded-lg hover:bg-infinite-gold/10 transition-all duration-300 font-medium">
              Invite Players
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
