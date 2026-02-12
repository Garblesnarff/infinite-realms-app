/* eslint-disable max-lines */
import { useQuery } from '@tanstack/react-query';
import { Play, Plus, Loader2 } from 'lucide-react';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { CharacterSelectionSkeleton } from '@/components/skeletons/CharacterSelectionSkeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Z_INDEX } from '@/constants/z-index';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Character {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  avatar_url?: string | null;
  background_image?: string | null;
  character_stats?: {
    strength?: number;
    dexterity?: number;
    constitution?: number;
    intelligence?: number;
    wisdom?: number;
    charisma?: number;
    armor_class?: number;
    max_hit_points?: number;
  };
}

interface StarterTemplate {
  id: string;
  starter_campaign_id: string;
  template_key: string;
  name: string;
  tagline: string | null;
  race: string;
  subrace: string | null;
  class: string;
  background: string | null;
  level: number;
  ability_scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  personality: Record<string, string[]>;
  skills: string[];
  languages: string[];
  equipment: string[];
  adapted_backstory: string | null;
  campaign_hook: string | null;
  portrait_url: string | null;
  portrait_prompt: string | null;
  display_order: number;
}

interface CharacterSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
}

/**
 * Modal component for selecting a character to play a campaign
 * For starter campaigns: shows pre-built character templates
 * For regular campaigns: shows user's existing characters
 */
const CharacterSelectionModal: React.FC<CharacterSelectionModalProps> = ({
  isOpen,
  onClose,
  campaignId,
  campaignName,
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isCreating, setIsCreating] = useState(false);

  // Check if this campaign is linked to a starter campaign
  const { data: starterCampaignId, isLoading: starterLoading } = useQuery({
    queryKey: ['campaign', campaignId, 'starterLink'],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data, error } = await supabase
        .from('game_sessions')
        .select('starter_campaign_id')
        .eq('campaign_id', campaignId)
        .not('starter_campaign_id', 'is', null)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error checking starter campaign link:', error);
        return null;
      }

      return data?.starter_campaign_id || null;
    },
    enabled: !!user?.id && isOpen,
  });

  // Fetch starter character templates (only when linked to starter campaign)
  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['starterTemplates', starterCampaignId],
    queryFn: async () => {
      if (!starterCampaignId) return [];

      const { data, error } = await supabase
        .from('starter_character_templates')
        .select('*')
        .eq('starter_campaign_id', starterCampaignId)
        .order('display_order');

      if (error) {
        console.error('Error fetching templates:', error);
        return [];
      }

      return (data || []) as StarterTemplate[];
    },
    enabled: !!starterCampaignId,
  });

  // Fetch available characters (only when NOT linked to starter campaign)
  const { data: characters, isLoading: charactersLoading } = useQuery({
    queryKey: ['campaign', campaignId, 'characters', 'play', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

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
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Character[];
    },
    enabled: !!user?.id && !starterCampaignId && !starterLoading,
  });

  const isLoading = starterLoading || (starterCampaignId ? templatesLoading : charactersLoading);
  const isStarterCampaign = !!starterCampaignId;

  /**
   * Create character from starter template and start game
   */
  const handleSelectTemplate = async (template: StarterTemplate) => {
    if (!user || isCreating) return;

    setIsCreating(true);

    try {
      // Create character from template
      const { data: character, error: charError } = await supabase
        .from('characters')
        .insert({
          user_id: user.id,
          name: template.name,
          race: template.race,
          subrace: template.subrace,
          class: template.class,
          level: template.level,
          background: template.background,
          backstory_elements: template.adapted_backstory,
          description: template.tagline,
          campaign_id: campaignId,
          skill_proficiencies: template.skills.join(', '),
          languages: template.languages,
          image_url: template.portrait_url,
        })
        .select('id')
        .single();

      if (charError) {
        console.error('Error creating character:', charError);
        throw charError;
      }

      // Create character stats
      const abilityScores = template.ability_scores || {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      };

      const { error: statsError } = await supabase.from('character_stats').insert({
        character_id: character.id,
        strength: abilityScores.strength,
        dexterity: abilityScores.dexterity,
        constitution: abilityScores.constitution,
        intelligence: abilityScores.intelligence,
        wisdom: abilityScores.wisdom,
        charisma: abilityScores.charisma,
        max_hit_points: 10 + Math.floor((abilityScores.constitution - 10) / 2),
        current_hit_points: 10 + Math.floor((abilityScores.constitution - 10) / 2),
        armor_class: 10 + Math.floor((abilityScores.dexterity - 10) / 2),
      });

      if (statsError) {
        console.error('Error creating character stats:', statsError);
        // Don't throw - character was created, stats are optional
      }

      toast({
        title: 'Starting Adventure!',
        description: `Beginning your journey with ${template.name} in ${campaignName}.`,
      });

      onClose();

      // Navigate to game with starter campaign reference
      setTimeout(() => {
        navigate(
          `/app/game/${campaignId}?character=${character.id}&starterCampaign=${starterCampaignId}&new=true`,
        );
      }, 0);
    } catch (err) {
      console.error('Error starting with character:', err);
      toast({
        title: 'Error',
        description: 'Failed to create character. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  /**
   * Handles starting a game with an existing character
   */
  const startGameWithCharacter = (character: Character) => {
    onClose();

    setTimeout(() => {
      navigate(`/app/game/${campaignId}?character=${character.id}&new=true`);
      toast({
        title: 'Starting Adventure!',
        description: `Beginning your journey with ${character.name} in ${campaignName}.`,
      });
    }, 0);
  };

  /**
   * Handles creating a new character
   */
  const handleCreateCharacter = () => {
    navigate(`/app/characters/create?campaign=${campaignId}`);
    onClose();
  };

  // Helper function to calculate ability modifier
  const getModifier = (score?: number) => {
    if (!score) return '+0';
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  };

  /**
   * Render a starter template card
   */
  const renderTemplateCard = (template: StarterTemplate) => {
    const abilityScores = template.ability_scores || {};

    return (
      <Card
        key={template.id}
        className="group cursor-pointer hover:shadow-2xl hover:shadow-infinite-purple/40 transition-all duration-500 overflow-hidden border-2 border-border/60 hover:border-infinite-gold/90 hover:scale-[1.02] relative bg-white dark:bg-background"
      >
        {/* Glow effect on hover */}
        <div
          className={`absolute inset-0 z-[${Z_INDEX.BACKGROUND_LAYER}] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`}
        >
          <div className="absolute inset-0 shadow-[inset_0_0_30px_rgba(168,85,247,0.4)]" />
        </div>

        <div
          className="relative h-32 bg-cover bg-center transition-all duration-700 ease-out group-hover:scale-105 group-hover:brightness-110"
          style={{
            backgroundImage: template.portrait_url
              ? `url(${template.portrait_url})`
              : `url(${new URL('/card-background.jpeg', import.meta.url).href})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/80 to-white/95 dark:from-background/60 dark:via-background/80 dark:to-background/95" />
          {template.portrait_url && (
            <div className="absolute -bottom-8 left-4 z-10">
              <img
                src={template.portrait_url}
                alt={`${template.name} portrait`}
                className="w-16 h-16 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 group-hover:scale-110 group-hover:border-infinite-purple group-hover:shadow-infinite-purple/70"
              />
            </div>
          )}
        </div>
        <CardContent className="p-4 pt-10 bg-white dark:bg-background">
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-lg text-foreground">{template.name}</h3>
              <p className="text-sm text-muted-foreground">
                Level {template.level} {template.race} {template.class}
              </p>
              {template.tagline && (
                <p className="text-xs text-muted-foreground italic mt-1">{template.tagline}</p>
              )}
            </div>

            {/* Ability Scores Grid */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">STR</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.strength)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">DEX</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.dexterity)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">CON</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.constitution)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">INT</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.intelligence)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">WIS</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.wisdom)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                <span className="font-semibold text-muted-foreground">CHA</span>
                <span className="text-lg font-bold text-foreground">
                  {getModifier(abilityScores.charisma)}
                </span>
              </div>
            </div>

            <Button
              onClick={() => handleSelectTemplate(template)}
              className="w-full"
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Adventure
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  /**
   * Render an existing character card
   */
  const renderCharacterCard = (character: Character) => {
    const stats = character.character_stats;
    const backgroundImage =
      character.background_image || new URL('/card-background.jpeg', import.meta.url).href;

    return (
      <Card
        key={character.id}
        className="group cursor-pointer hover:shadow-2xl hover:shadow-infinite-purple/40 transition-all duration-500 overflow-hidden border-2 border-border/60 hover:border-infinite-gold/90 hover:scale-[1.02] relative bg-white dark:bg-background"
      >
        {/* Glow effect on hover */}
        <div
          className={`absolute inset-0 z-[${Z_INDEX.BACKGROUND_LAYER}] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`}
        >
          <div className="absolute inset-0 shadow-[inset_0_0_30px_rgba(168,85,247,0.4)]" />
        </div>

        <div
          className="relative h-32 bg-cover bg-center transition-all duration-700 ease-out group-hover:scale-105 group-hover:brightness-110"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/80 to-white/95 dark:from-background/60 dark:via-background/80 dark:to-background/95" />
          {character.avatar_url && (
            <div className="absolute -bottom-8 left-4 z-10">
              <img
                src={character.avatar_url}
                alt={`${character.name} avatar`}
                className="w-16 h-16 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 group-hover:scale-110 group-hover:border-infinite-purple group-hover:shadow-infinite-purple/70"
              />
            </div>
          )}
        </div>
        <CardContent className="p-4 pt-10 bg-white dark:bg-background">
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-lg text-foreground">{character.name}</h3>
              <p className="text-sm text-muted-foreground">
                Level {character.level} {character.race} {character.class}
              </p>
            </div>

            {stats && (
              <>
                {/* HP and AC */}
                <div className="flex gap-4 text-sm bg-gray-100 dark:bg-muted p-2 rounded-md border border-gray-200 dark:border-border">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-foreground">HP:</span>
                    <span className="text-foreground">{stats.max_hit_points || '\u2014'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-foreground">AC:</span>
                    <span className="text-foreground">{stats.armor_class || '\u2014'}</span>
                  </div>
                </div>

                {/* Ability Scores Grid */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">STR</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.strength)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">DEX</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.dexterity)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">CON</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.constitution)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">INT</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.intelligence)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">WIS</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.wisdom)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-2 bg-gray-50 dark:bg-muted/50 rounded border border-gray-200 dark:border-border shadow-sm">
                    <span className="font-semibold text-muted-foreground">CHA</span>
                    <span className="text-lg font-bold text-foreground">
                      {getModifier(stats.charisma)}
                    </span>
                  </div>
                </div>
              </>
            )}

            <Button onClick={() => startGameWithCharacter(character)} className="w-full">
              <Play className="h-4 w-4 mr-2" />
              Start Adventure
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose Your Character</DialogTitle>
          <DialogDescription>
            {isStarterCampaign
              ? `Select a pre-built character for "${campaignName}"`
              : `Select a character to play in "${campaignName}"`}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {isLoading ? (
            <CharacterSelectionSkeleton />
          ) : isStarterCampaign && templates && templates.length > 0 ? (
            // Show starter templates
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map(renderTemplateCard)}
            </div>
          ) : !isStarterCampaign && characters && characters.length > 0 ? (
            // Show user's characters
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {characters.map(renderCharacterCard)}
            </div>
          ) : (
            // Empty state
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                {isStarterCampaign
                  ? 'No character templates available for this campaign.'
                  : "You don't have any characters yet."}
              </p>
              {!isStarterCampaign && (
                <Button onClick={handleCreateCharacter}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Character
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CharacterSelectionModal;
