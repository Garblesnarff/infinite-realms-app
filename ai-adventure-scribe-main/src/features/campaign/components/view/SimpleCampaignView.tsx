import { Shield, Sword, Star } from 'lucide-react';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { CampaignCharacterSelection } from './CampaignCharacterSelection';

import type { Campaign, CharacterListItem } from './types';
import type { Character } from '@/types/character';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Z_INDEX } from '@/constants/z-index';
import { useAuth } from '@/contexts/AuthContext';
import { SimpleGameChatWithVoice } from '@/features/game-session/components';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

export const SimpleCampaignView: React.FC = () => {
  const { id: campaignId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const characterIdFromUrl = searchParams.get('character');

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [characters, setCharacters] = useState<CharacterListItem[]>([]);
  const [selectedCharacter] = useState<CharacterListItem | null>(null);
  const [fullSelectedCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (campaignId) {
      loadCampaignData();
      loadUserCharacters();
    }
  }, [campaignId, user]);

  useEffect(() => {
    if (characterIdFromUrl && characters.length > 0) {
      const character = characters.find((c) => c.id === characterIdFromUrl);
      if (character) {
        // Navigate directly to the game route with this character
        navigate(`/app/game/${campaignId}?character=${character.id}`);
      }
    }
  }, [characterIdFromUrl, characters, navigate, campaignId]);

  const loadCampaignData = async () => {
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId!)
        .single();

      if (error) throw error;
      setCampaign(data);
    } catch (error) {
      logger.error('Error loading campaign:', error);
      toast.error('Failed to load campaign data');
    }
  };

  const loadUserCharacters = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('characters')
        .select(
          `
          id, name, race, class, level, avatar_url, background_image,
          character_stats (
            strength, dexterity, constitution,
            intelligence, wisdom, charisma,
            armor_class, max_hit_points
          )
        `,
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCharacters(
        (data || []).map((char) => ({
          ...char,
          level: char.level || 1,
          character_stats: Array.isArray(char.character_stats)
            ? char.character_stats[0]
            : char.character_stats,
        })) as CharacterListItem[],
      );
    } catch (error) {
      logger.error('Error loading characters:', error);
      toast.error('Failed to load characters');
    } finally {
      setLoading(false);
    }
  };

  const startGameWithCharacter = useCallback(
    async (character: CharacterListItem) => {
      // Navigate to the game route with campaign ID and character ID as query param
      navigate(`/app/game/${campaignId}?character=${character.id}`);
    },
    [navigate, campaignId],
  );

  // Memoize characters array to prevent unnecessary re-renders
  const memoizedCharacters = useMemo(() => characters, [characters]);

  const getInitial = useMemo(() => (name: string) => name.charAt(0).toUpperCase(), []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="w-full max-w-4xl p-6 space-y-4">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-6 w-1/3" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Campaign not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-indigo-100">
      {/* Campaign Banner Header */}
      <div className="relative">
        <div
          className="h-48 sm:h-56 md:h-64 lg:h-72 bg-cover bg-center bg-no-repeat relative overflow-hidden"
          style={{
            backgroundImage: `url('/card-background.jpeg')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center center',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 to-transparent"></div>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent h-32"></div>
        </div>

        {/* Header Content */}
        <div className="absolute top-8 left-8 right-8">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-4xl font-bold text-white mb-2 drop-shadow-lg">
                {campaign.name}
              </CardTitle>
              <div className="flex flex-wrap gap-2 mb-4">
                <Badge
                  variant="secondary"
                  className="bg-infinite-gold/20 text-infinite-gold border-infinite-gold/30"
                >
                  {campaign.genre || 'Unknown'}
                </Badge>
                <Badge
                  variant="secondary"
                  className="bg-destructive/20 text-destructive border-destructive/30"
                >
                  {campaign.difficulty_level || 'Unknown'}
                </Badge>
                <Badge
                  variant="secondary"
                  className="bg-secondary/20 text-secondary-foreground border-secondary/30"
                >
                  {campaign.campaign_length || 'Unknown'}
                </Badge>
                <Badge
                  variant="secondary"
                  className="bg-secondary/20 text-secondary-foreground border-secondary/30"
                >
                  {campaign.tone || 'Unknown'}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="container mx-auto px-4 py-8 relative -mt-16"
        style={{ zIndex: Z_INDEX.DROPDOWN }}
      >
        {!selectedCharacter ? (
          <CampaignCharacterSelection
            campaign={campaign}
            characters={memoizedCharacters}
            onStartGame={startGameWithCharacter}
          />
        ) : (
          /* Game Interface Layout - Chat at top, details below */
          <div className="space-y-8">
            {/* AI DM Chat Window - Full Width */}
            <div className="w-full">
              <SimpleGameChatWithVoice
                campaignId={campaign.id}
                characterId={selectedCharacter!.id}
                campaignDetails={campaign}
                characterDetails={selectedCharacter}
              />
            </div>

            {/* Character and Campaign Details Below Chat */}
            <div className="grid lg:grid-cols-2 gap-8">
              {/* Campaign Details */}
              <Card className="bg-background/80 backdrop-blur-sm border-border/50">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-foreground">
                    <Shield className="w-5 h-5 text-infinite-purple" />
                    Campaign Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-medium min-w-[4rem]">Era:</span>
                      <span>{campaign.era || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-medium min-w-[4rem]">Location:</span>
                      <span>{campaign.location || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-medium min-w-[4rem]">Atmosphere:</span>
                      <span>{campaign.atmosphere || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-medium min-w-[4rem]">Genre:</span>
                      <span>{campaign.genre || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-medium min-w-[4rem]">Difficulty:</span>
                      <span>{campaign.difficulty_level || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-medium min-w-[4rem]">Length:</span>
                      <span>{campaign.campaign_length || 'Unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="font-medium min-w-[4rem]">Tone:</span>
                      <span>{campaign.tone || 'Unknown'}</span>
                    </div>
                  </div>
                  {campaign.description && (
                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="description">
                        <AccordionTrigger className="text-sm font-medium hover:no-underline">
                          Description
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground pt-2">
                          <p>{campaign.description}</p>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </CardContent>
              </Card>

              {/* Character Details */}
              {selectedCharacter && (
                <Card className="bg-background/80 backdrop-blur-sm border-border/50">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Sword className="w-5 h-5 text-infinite-teal" />
                      {selectedCharacter.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-infinite-purple to-infinite-teal flex items-center justify-center text-white text-xs font-bold">
                        {getInitial(selectedCharacter.name)}
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">
                          Level {selectedCharacter.level || 1}
                        </div>
                        <div className="text-muted-foreground">
                          {selectedCharacter.race} {selectedCharacter.class}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-infinite-gold">
                      <Star className="w-4 h-4" />
                      <span>Active Hero</span>
                    </div>
                    {fullSelectedCharacter ? (
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        {[
                          'strength',
                          'dexterity',
                          'constitution',
                          'intelligence',
                          'wisdom',
                          'charisma',
                        ].map((ability) => {
                          const abilityScore =
                            fullSelectedCharacter.abilityScores?.[
                              ability as keyof typeof fullSelectedCharacter.abilityScores
                            ];
                          return (
                            <div key={ability} className="text-center py-1">
                              <div className="text-xs font-medium capitalize">{ability}</div>
                              <div className="text-sm font-bold">
                                {abilityScore
                                  ? `${abilityScore.score} (${abilityScore.modifier >= 0 ? '+' : ''}${abilityScore.modifier})`
                                  : '—'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-2 text-muted-foreground">
                        Loading character stats...
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
