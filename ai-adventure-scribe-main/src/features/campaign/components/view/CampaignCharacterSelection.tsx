import { Play, Users, Shield, Sword, Star } from 'lucide-react';
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Campaign, CharacterListItem } from './types';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import CampaignGallery from '@/features/campaign/components/gallery/CampaignGallery';
import { analytics } from '@/services/analytics';

interface CampaignCharacterSelectionProps {
  campaign: Campaign;
  characters: CharacterListItem[];
  onStartGame: (character: CharacterListItem) => void;
}

export const CampaignCharacterSelection: React.FC<CampaignCharacterSelectionProps> = ({
  campaign,
  characters,
  onStartGame,
}) => {
  const navigate = useNavigate();

  // Generate character avatar color
  const getCharacterAvatarColor = useMemo(
    () => (name: string) => {
      const colors = [
        'bg-infinite-purple',
        'bg-infinite-gold',
        'bg-infinite-teal',
        'bg-destructive',
        'bg-secondary',
      ];
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      return colors[Math.abs(hash) % colors.length];
    },
    [],
  );

  const getInitial = useMemo(() => (name: string) => name.charAt(0).toUpperCase(), []);

  return (
    <div className="grid lg:grid-cols-3 gap-8">
      {/* Campaign Details Sidebar */}
      <div className="lg:col-span-1 space-y-6">
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

        {/* Campaign Gallery */}
        <Card className="bg-background/80 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-foreground">Gallery</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignGallery
              campaignId={campaign.id}
              backgroundImageUrl={campaign.background_image}
            />
          </CardContent>
        </Card>
      </div>

      {/* Character Selection */}
      <div className="lg:col-span-2 space-y-8">
        <Card className="bg-background/80 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-6">
            <CardTitle className="flex items-center gap-2 text-2xl font-bold">
              <Users className="h-6 w-6 text-infinite-purple" />
              Select Your Hero
            </CardTitle>
            <p className="text-muted-foreground text-lg">
              Choose the character who will embark on this legendary quest
            </p>
          </CardHeader>
          <CardContent>
            {characters.length === 0 ? (
              <div className="text-center py-12 bg-muted/30 rounded-xl">
                <Users className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-6 text-lg">No heroes forged yet</p>
                <Button
                  onClick={() => {
                    analytics.characterCreationStarted({
                      campaignId: campaign.id,
                      artStyle: campaign.genre || undefined,
                    });
                    navigate(`/app/characters/create?campaign=${campaign.id}`);
                  }}
                  variant="fantasy"
                  size="lg"
                  className="px-8"
                >
                  <Play className="w-5 h-5 mr-2" />
                  Forge Your First Hero
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {characters.map((character) => {
                  const backgroundImage =
                    character.background_image ||
                    new URL('/card-background.jpeg', import.meta.url).href;
                  return (
                    <Card
                      key={character.id}
                      className="group cursor-pointer hover:shadow-2xl hover:shadow-infinite-purple/50 transition-all duration-500 border-2 border-border/50 hover:border-infinite-gold/70 overflow-hidden relative"
                    >
                      {/* Glow effect on hover */}
                      <div
                        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                        style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
                      >
                        <div className="absolute inset-0 shadow-[inset_0_0_30px_rgba(168,85,247,0.4)]" />
                      </div>

                      {/* Background Image Layer with zoom on hover */}
                      <div
                        className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-110 group-hover:brightness-110"
                        style={{
                          backgroundImage: `url(${backgroundImage})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          zIndex: Z_INDEX.BASE,
                        }}
                      />
                      {/* Dark Overlay for Text Readability */}
                      <div
                        className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/70 to-black/80 transition-opacity duration-500 group-hover:from-black/50 group-hover:via-black/60 group-hover:to-black/70"
                        style={{ zIndex: Z_INDEX.BASE }}
                      />

                      <CardContent className="p-6 relative" style={{ zIndex: Z_INDEX.DROPDOWN }}>
                        {/* Character Avatar */}
                        <div
                          className={`absolute -top-4 left-6 w-20 h-20 rounded-full overflow-hidden border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 group-hover:scale-110 group-hover:border-infinite-purple group-hover:shadow-infinite-purple/70 transition-all duration-300 ${!character.avatar_url ? getCharacterAvatarColor(character.name) : ''}`}
                        >
                          {character.avatar_url ? (
                            <img
                              src={character.avatar_url}
                              alt={`${character.name} avatar`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-white">
                              {getInitial(character.name)}
                            </div>
                          )}
                        </div>

                        <div className="pt-12 space-y-4">
                          <div>
                            <h3 className="text-xl font-bold text-white drop-shadow-lg group-hover:text-infinite-purple transition-colors">
                              {character.name}
                            </h3>
                            <div className="flex items-center gap-2 text-sm text-gray-200 mt-1">
                              <Star className="w-4 h-4 text-infinite-gold" />
                              <span>Level {character.level || 1}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 text-sm">
                            <div className="flex items-center gap-1 text-gray-200">
                              <Shield className="w-4 h-4" />
                              <span>{character.race}</span>
                            </div>
                            <div className="flex items-center gap-1 text-gray-200">
                              <Sword className="w-4 h-4" />
                              <span>{character.class}</span>
                            </div>
                          </div>

                          {character.character_stats && (
                            <div className="space-y-3">
                              {/* HP and AC */}
                              <div className="flex gap-4 text-sm">
                                <div className="flex items-center gap-1">
                                  <span className="font-semibold text-white">HP:</span>
                                  <span className="text-gray-200">
                                    {character.character_stats.max_hit_points || '—'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="font-semibold text-white">AC:</span>
                                  <span className="text-gray-200">
                                    {character.character_stats.armor_class || '—'}
                                  </span>
                                </div>
                              </div>

                              {/* Ability Scores */}
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                {[
                                  { name: 'STR', value: character.character_stats.strength },
                                  { name: 'DEX', value: character.character_stats.dexterity },
                                  {
                                    name: 'CON',
                                    value: character.character_stats.constitution,
                                  },
                                  {
                                    name: 'INT',
                                    value: character.character_stats.intelligence,
                                  },
                                  { name: 'WIS', value: character.character_stats.wisdom },
                                  { name: 'CHA', value: character.character_stats.charisma },
                                ].map((stat) => {
                                  const modifier = stat.value
                                    ? Math.floor((stat.value - 10) / 2)
                                    : 0;
                                  const modifierText =
                                    modifier >= 0 ? `+${modifier}` : `${modifier}`;
                                  return (
                                    <div
                                      key={stat.name}
                                      className="flex flex-col items-center p-2 bg-black/40 rounded backdrop-blur-sm"
                                    >
                                      <span className="font-semibold text-gray-300">
                                        {stat.name}
                                      </span>
                                      <span className="text-base font-bold text-white">
                                        {stat.value || '—'}
                                      </span>
                                      <span className="text-xs text-gray-300">
                                        ({modifierText})
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          <Button
                            onClick={() => onStartGame(character)}
                            variant="fantasy"
                            size="lg"
                            className="w-full group-hover:shadow-lg transition-shadow duration-200"
                          >
                            <Play className="h-5 w-5 mr-2" />
                            Embark on Adventure
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
