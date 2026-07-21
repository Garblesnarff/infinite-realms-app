import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { CampaignOverviewSidebar } from './CampaignOverviewSidebar';
import { CampaignOverviewSkeleton } from './CampaignOverviewSkeleton';

import CampaignGallery from '@/components/gallery/CampaignGallery';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { userDataApi } from '@/services/user-data-api';

interface CampaignOverviewProps {
  campaign?: {
    id: string;
    description?: string | null;
    genre?: string | null;
    tone?: string | null;
    campaign_length?: string | null;
    difficulty_level?: string | null;
    background_image?: string | null;
  } | null;
  onStartNewSession?: () => void;
}

// Session expiry times
// Free tier: 7 days
// Paid tier: 6 months (182 days)
const FREE_SESSION_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7;
const PAID_SESSION_EXPIRY_MS = 1000 * 60 * 60 * 24 * 182;

const CampaignOverview: React.FC<CampaignOverviewProps> = ({ campaign, onStartNewSession }) => {
  const { id: campaignId } = useParams();
  const navigate = useNavigate();
  const { userPlan } = useAuth();

  const sessionExpiryMs =
    userPlan && userPlan !== 'free' ? PAID_SESSION_EXPIRY_MS : FREE_SESSION_EXPIRY_MS;

  // Query for most recent active session
  const { data: activeSession, isLoading: isLoadingActiveSession } = useQuery({
    queryKey: ['campaign', campaignId, 'active-session'],
    queryFn: async () => {
      if (!campaignId) return null;

      const [data] = await userDataApi.listSessions({ campaignId, status: 'active', limit: 1 });
      if (!data) return null;

      // Check if expired (24 hours)
      const start = data.start_time || data.created_at;
      if (!start) return null;

      const startTime = new Date(start).getTime();
      const isExpired = Number.isFinite(startTime)
        ? Date.now() - startTime > sessionExpiryMs
        : false;

      return isExpired ? null : data;
    },
    enabled: Boolean(campaignId),
  });

  const handleResumeSession = () => {
    if (!activeSession?.character_id || !campaignId) return;
    navigate(`/app/game/${campaignId}?character=${activeSession.character_id}`);
  };

  if (!campaign) {
    return <CampaignOverviewSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Immersive Hero Section - Integrated with Header */}
      <div className="relative h-48 sm:h-64 rounded-2xl overflow-hidden bg-gradient-to-br from-infinite-dark via-infinite-purple/20 to-infinite-dark">
        {campaign.background_image && (
          <img
            src={campaign.background_image}
            alt="Campaign background"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/60"></div>

        {/* Floating Elements */}
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-infinite-gold/30 rounded-full animate-pulse"></div>
          <div className="absolute top-1/3 right-1/3 w-1 h-1 bg-white/40 rounded-full animate-pulse delay-1000"></div>
          <div className="absolute bottom-1/4 left-1/2 w-1.5 h-1.5 bg-infinite-teal/40 rounded-full animate-pulse delay-500"></div>
        </div>

        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex flex-wrap gap-2">
            {campaign.genre && (
              <Badge className="bg-infinite-purple/20 text-infinite-purple border-infinite-purple/30 hover:bg-infinite-purple/30">
                {campaign.genre}
              </Badge>
            )}
            {campaign.difficulty_level && (
              <Badge className="bg-infinite-teal/20 text-infinite-teal border-infinite-teal/30 hover:bg-infinite-teal/30">
                {campaign.difficulty_level}
              </Badge>
            )}
            {campaign.campaign_length && (
              <Badge className="bg-infinite-gold/20 text-infinite-gold border-infinite-gold/30 hover:bg-infinite-gold/30">
                {campaign.campaign_length}
              </Badge>
            )}
            {campaign.tone && (
              <Badge variant="outline" className="border-white/30 text-white/90 hover:bg-white/10">
                {campaign.tone}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Description Panel */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-strong rounded-2xl p-8 hover-lift">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-infinite-purple to-infinite-gold flex items-center justify-center">
                <span className="text-white font-bold text-lg">📜</span>
              </div>
              <h2 className="text-2xl font-bold text-foreground">Campaign Overview</h2>
            </div>

            <div className="prose prose-lg max-w-none">
              <p className="text-foreground leading-relaxed whitespace-pre-line text-base sm:text-lg">
                {campaign.description || 'No description provided yet. The journey awaits...'}
              </p>
            </div>

            {/* Campaign Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-border">
              {campaign.genre && (
                <div className="text-center p-3 rounded-lg bg-infinite-purple/10 border border-infinite-purple/20">
                  <div className="text-infinite-purple font-semibold text-sm">Genre</div>
                  <div className="text-foreground text-sm">{campaign.genre}</div>
                </div>
              )}
              {campaign.tone && (
                <div className="text-center p-3 rounded-lg bg-muted border border-border">
                  <div className="text-muted-foreground font-semibold text-sm">Tone</div>
                  <div className="text-foreground font-medium text-sm">{campaign.tone}</div>
                </div>
              )}
              {campaign.campaign_length && (
                <div className="text-center p-3 rounded-lg bg-infinite-gold/10 border border-infinite-gold/20">
                  <div className="text-infinite-gold font-semibold text-sm">Length</div>
                  <div className="text-foreground text-sm">{campaign.campaign_length}</div>
                </div>
              )}
              {campaign.difficulty_level && (
                <div className="text-center p-3 rounded-lg bg-infinite-teal/10 border border-infinite-teal/20">
                  <div className="text-infinite-teal font-semibold text-sm">Difficulty</div>
                  <div className="text-foreground text-sm">{campaign.difficulty_level}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Info Panel */}
        <CampaignOverviewSidebar
          hasActiveSession={Boolean(activeSession)}
          isLoadingActiveSession={isLoadingActiveSession}
          onResumeSession={handleResumeSession}
          onStartNewSession={onStartNewSession}
        />
      </div>

      {/* Enhanced Gallery Section */}
      <div className="glass-strong rounded-2xl p-8 hover-lift">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-infinite-teal to-infinite-purple flex items-center justify-center">
            <span className="text-white font-bold text-lg">🎨</span>
          </div>
          <h2 className="text-2xl font-bold text-foreground">Campaign Gallery</h2>
        </div>

        {campaignId && (
          <CampaignGallery
            campaignId={campaignId as string}
            backgroundImageUrl={campaign.background_image ?? null}
          />
        )}
      </div>
    </div>
  );
};

export default CampaignOverview;
