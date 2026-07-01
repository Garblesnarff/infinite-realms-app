import { Map, Calendar, Settings, Sparkles, Star, BookOpen } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useCampaign } from '@/contexts/CampaignContext';

/**
 * Real-time campaign preview component
 * Shows campaign progression and current settings as choices are made
 */
const CampaignPreview: React.FC = () => {
  const { state } = useCampaign();
  const campaign = state.campaign;

  if (!campaign) {
    return (
      <Card className="p-6 ir-panel border-2 border-dashed border-infinite-purple/25">
        <div className="text-center space-y-4">
          <div className="w-24 h-24 mx-auto bg-muted rounded-full flex items-center justify-center">
            <Sparkles className="w-12 h-12 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Campaign Preview</h3>
            <p className="text-sm text-muted-foreground">
              Your campaign will appear here as you make choices
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const getGenreColor = (genre: string) => {
    switch (genre?.toLowerCase()) {
      case 'fantasy':
        return 'bg-infinite-purple/15 text-infinite-purple border-infinite-purple/30';
      case 'sci-fi':
        return 'bg-infinite-teal/15 text-infinite-teal border-infinite-teal/30';
      case 'horror':
        return 'bg-red-500/15 text-red-400 border-red-500/30';
      case 'modern':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'historical':
        return 'bg-infinite-gold/15 text-infinite-gold border-infinite-gold/30';
      default:
        return 'bg-white/10 text-muted-foreground border-white/10';
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty?.toLowerCase()) {
      case 'easy':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'medium':
        return 'bg-infinite-gold/15 text-infinite-gold border-infinite-gold/30';
      case 'hard':
        return 'bg-red-500/15 text-red-400 border-red-500/30';
      case 'nightmare':
        return 'bg-infinite-purple/15 text-infinite-purple border-infinite-purple/30';
      default:
        return 'bg-white/10 text-muted-foreground border-white/10';
    }
  };

  const getToneColor = (tone: string) => {
    switch (tone?.toLowerCase()) {
      case 'serious':
        return 'bg-infinite-teal/15 text-infinite-teal border-infinite-teal/30';
      case 'humorous':
        return 'bg-infinite-gold/15 text-infinite-gold border-infinite-gold/30';
      case 'gritty':
        return 'bg-red-500/15 text-red-400 border-red-500/30';
      default:
        return 'bg-white/10 text-muted-foreground border-white/10';
    }
  };

  return (
    <Card className="p-6 ir-panel border border-infinite-purple/20">
      <div className="space-y-6">
        {/* Campaign Header */}
        <div className="text-center space-y-3">
          <div className="relative">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-infinite-purple to-infinite-gold rounded-full flex items-center justify-center border-4 border-infinite-gold/40 shadow-lg">
              <Map className="w-10 h-10 text-white" />
            </div>
            {campaign.name && (
              <Badge className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-infinite-dark-lighter text-infinite-gold border-2 border-infinite-purple/30">
                Campaign
              </Badge>
            )}
          </div>

          <div>
            <h3 className="font-bold ir-display text-xl font-semibold text-foreground">
              {campaign.name || 'Untitled Campaign'}
            </h3>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {campaign.genre && (
                <Badge variant="secondary" className={getGenreColor(campaign.genre)}>
                  {campaign.genre}
                </Badge>
              )}
              {campaign.difficulty_level && (
                <Badge
                  variant="secondary"
                  className={getDifficultyColor(campaign.difficulty_level)}
                >
                  {campaign.difficulty_level}
                </Badge>
              )}
              {campaign.tone && (
                <Badge variant="secondary" className={getToneColor(campaign.tone)}>
                  {campaign.tone}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <Separator className="bg-white/10" />

        {/* Campaign Details */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm text-muted-foreground flex items-center">
            <Settings className="w-4 h-4 mr-2" />
            Campaign Settings
          </h4>
          <div className="grid grid-cols-1 gap-2">
            {campaign.campaign_length && (
              <div className="flex items-center justify-between p-2 bg-white/[0.04] rounded-lg border border-white/10">
                <div className="flex items-center space-x-2">
                  <Calendar className="w-4 h-4" />
                  <span className="text-xs font-medium">Campaign Length</span>
                </div>
                <div className="font-bold text-sm capitalize">{campaign.campaign_length}</div>
              </div>
            )}
            {campaign.setting?.location && (
              <div className="flex items-center justify-between p-2 bg-white/[0.04] rounded-lg border border-white/10">
                <div className="flex items-center space-x-2">
                  <Map className="w-4 h-4" />
                  <span className="text-xs font-medium">Location</span>
                </div>
                <div className="font-bold text-sm">{campaign.setting.location}</div>
              </div>
            )}
          </div>
        </div>

        {/* Campaign Description */}
        {campaign.description && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm text-muted-foreground flex items-center">
              <BookOpen className="w-4 h-4 mr-2" />
              Description
            </h4>
            <p className="text-xs text-muted-foreground line-clamp-3 bg-white/[0.04] p-2 rounded border border-white/10">
              {campaign.description}
            </p>
          </div>
        )}

        {/* Campaign Status */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm text-muted-foreground flex items-center">
            <Star className="w-4 h-4 mr-2" />
            Creation Progress
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center p-2 bg-white/[0.04] rounded-lg border border-white/10">
              <div className="text-lg font-bold text-infinite-teal">
                {campaign.genre ? '1' : '0'}/4
              </div>
              <div className="text-xs text-muted-foreground">Steps Complete</div>
            </div>
            <div className="text-center p-2 bg-white/[0.04] rounded-lg border border-white/10">
              <div className="text-lg font-bold text-emerald-400">{campaign.name ? '✓' : '○'}</div>
              <div className="text-xs text-muted-foreground">Ready to Play</div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default CampaignPreview;
