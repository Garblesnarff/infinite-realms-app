/* eslint-disable max-lines -- pre-existing length; restyle-only change. Tracked for decomposition. */
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import CampaignGallery from '@/components/gallery/CampaignGallery';
import { Badge } from '@/components/ui/badge';
import { isMultiplayerInvitesEnabled } from '@/config/featureFlags';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

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

      const { data, error } = await supabase
        .from('game_sessions')
        .select('id, character_id, status, start_time, created_at')
        .eq('campaign_id', campaignId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

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
    return (
      <div className="space-y-8">
        {/* Hero Skeleton */}
        <div className="relative h-64 sm:h-80 rounded-2xl bg-gradient-to-br from-infinite-dark-lighter via-infinite-purple/20 to-infinite-dark animate-pulse">
          <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/25 to-black/40 rounded-2xl"></div>
          <div className="absolute bottom-6 left-6 right-6">
            <div className="h-8 bg-white/20 rounded-lg w-1/3 mb-4"></div>
            <div className="flex gap-2">
              <div className="h-6 bg-white/20 rounded-full w-16"></div>
              <div className="h-6 bg-white/20 rounded-full w-20"></div>
              <div className="h-6 bg-white/20 rounded-full w-18"></div>
            </div>
          </div>
        </div>

        {/* Content Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-strong rounded-2xl p-8">
              <div className="h-8 bg-white/20 rounded-lg w-1/4 mb-6"></div>
              <div className="space-y-4">
                <div className="h-4 bg-white/10 rounded w-full"></div>
                <div className="h-4 bg-white/10 rounded w-5/6"></div>
                <div className="h-4 bg-white/10 rounded w-4/5"></div>
              </div>
            </div>
          </div>
          <div className="space-y-6">
            <div className="glass-strong rounded-2xl p-6">
              <div className="h-6 bg-white/20 rounded-lg w-1/2 mb-4"></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="h-4 bg-white/10 rounded"></div>
                <div className="h-4 bg-white/10 rounded"></div>
                <div className="h-4 bg-white/10 rounded"></div>
                <div className="h-4 bg-white/10 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Immersive Hero Section - Integrated with Header */}
      <div className="relative h-48 sm:h-64 rounded-2xl overflow-hidden bg-gradient-to-br from-infinite-dark-lighter via-infinite-purple/20 to-infinite-dark">
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-white/10">
              {campaign.genre && (
                <div className="text-center p-3 rounded-lg bg-infinite-purple/10 border border-infinite-purple/20">
                  <div className="text-infinite-purple font-semibold text-sm">Genre</div>
                  <div className="text-foreground text-sm">{campaign.genre}</div>
                </div>
              )}
              {campaign.tone && (
                <div className="text-center p-3 rounded-lg bg-white/10 border border-white/10">
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
        <div className="space-y-6">
          <div className="glass-strong rounded-2xl p-6 hover-lift">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-foreground">
              <span className="w-2 h-2 rounded-full bg-infinite-gold"></span>
              Campaign Details
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-2 border-b border-white/10">
                <span className="text-muted-foreground font-medium">Status</span>
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                  Active
                </Badge>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-white/10">
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
              {activeSession && (
                <button
                  onClick={handleResumeSession}
                  disabled={isLoadingActiveSession}
                  className="w-full px-4 py-3 bg-gradient-to-r from-infinite-teal to-infinite-teal-dark text-white rounded-lg hover:from-infinite-teal-dark hover:to-infinite-teal transition-all duration-300 hover-lift font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Resume Session
                </button>
              )}
              <button
                onClick={() => onStartNewSession?.()}
                className="w-full px-4 py-3 bg-gradient-to-r from-infinite-purple to-infinite-purple-dark text-white rounded-lg hover:from-infinite-purple-dark hover:to-infinite-purple transition-all duration-300 hover-lift font-medium disabled:opacity-50 disabled:cursor-not-allowed"
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
