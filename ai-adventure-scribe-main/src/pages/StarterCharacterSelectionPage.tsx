/**
 * Starter Character Selection Page
 *
 * Displays pre-built character options for a starter campaign.
 * Users can:
 * - Select a pre-made character (quick start)
 * - Create a custom character (redirect to wizard)
 *
 * Route: /explore/:slug/choose-character
 */

import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Sparkles, User, ChevronRight, Sword, Heart, BookOpen, Wand2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useStarterCampaign } from '@/hooks/use-starter-campaigns';
import {
  useStarterCharacterTemplates,
  StarterCharacterTemplate,
} from '@/hooks/use-starter-character-templates';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

/**
 * Get class icon component
 */
function getClassIcon(className: string): React.ReactNode {
  const iconProps = { className: 'w-5 h-5' };
  switch (className.toLowerCase()) {
    case 'fighter':
    case 'ranger':
    case 'barbarian':
    case 'paladin':
      return <Sword {...iconProps} />;
    case 'cleric':
    case 'druid':
      return <Heart {...iconProps} />;
    case 'wizard':
    case 'warlock':
    case 'sorcerer':
      return <Wand2 {...iconProps} />;
    case 'bard':
    case 'rogue':
      return <BookOpen {...iconProps} />;
    default:
      return <User {...iconProps} />;
  }
}

/**
 * Get ability modifier from score
 */
function getModifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/**
 * Character Card Component
 */
interface CharacterCardProps {
  template: StarterCharacterTemplate;
  isSelected: boolean;
  onSelect: () => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({ template, isSelected, onSelect }) => {
  return (
    <button
      onClick={onSelect}
      className={`relative flex flex-col items-center p-4 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] text-left w-full ${
        isSelected
          ? 'border-purple-500 bg-purple-500/20 shadow-lg shadow-purple-500/20'
          : 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800/70'
      }`}
    >
      {/* Portrait Placeholder */}
      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-600/30 to-amber-600/30 flex items-center justify-center mb-3 border-2 border-gray-600">
        {template.portraitUrl ? (
          <img
            src={template.portraitUrl}
            alt={template.name}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <div className="text-3xl text-gray-400">{getClassIcon(template.class)}</div>
        )}
      </div>

      {/* Name and Class */}
      <h3 className="text-lg font-bold text-white text-center">{template.name}</h3>
      <p className="text-sm text-purple-300 mb-1">
        {template.race} {template.class}
      </p>
      <p className="text-xs text-gray-400 text-center line-clamp-2">{template.tagline}</p>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </button>
  );
};

/**
 * Character Details Panel
 */
interface CharacterDetailsPanelProps {
  template: StarterCharacterTemplate;
}

const CharacterDetailsPanel: React.FC<CharacterDetailsPanelProps> = ({ template }) => {
  const { abilityScores, personality } = template;

  return (
    <div className="bg-gray-800/70 rounded-xl p-6 border border-gray-700">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-600/30 to-amber-600/30 flex items-center justify-center border-2 border-purple-500/50">
          {template.portraitUrl ? (
            <img
              src={template.portraitUrl}
              alt={template.name}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <div className="text-2xl text-purple-300">{getClassIcon(template.class)}</div>
          )}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{template.name}</h2>
          <p className="text-purple-300">
            {template.race}
            {template.subrace && ` (${template.subrace})`} {template.class}
          </p>
          {template.background && <p className="text-sm text-gray-400">{template.background}</p>}
        </div>
      </div>

      {/* Ability Scores */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Ability Scores
        </h3>
        <div className="grid grid-cols-6 gap-2">
          {Object.entries(abilityScores).map(([ability, score]) => (
            <div
              key={ability}
              className="bg-gray-900/50 rounded-lg p-2 text-center border border-gray-700"
            >
              <p className="text-xs text-gray-400 uppercase">{ability.slice(0, 3)}</p>
              <p className="text-lg font-bold text-white">{score}</p>
              <p className="text-xs text-purple-300">{getModifier(score)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Backstory */}
      {template.adaptedBackstory && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Backstory
          </h3>
          <p className="text-gray-300 text-sm leading-relaxed">{template.adaptedBackstory}</p>
        </div>
      )}

      {/* Campaign Hook */}
      {template.campaignHook && (
        <div className="mb-6 bg-purple-900/20 rounded-lg p-4 border border-purple-500/20">
          <h3 className="text-sm font-semibold text-purple-300 mb-2">Why You're Here</h3>
          <p className="text-gray-300 text-sm italic">{template.campaignHook}</p>
        </div>
      )}

      {/* Personality */}
      {personality.traits && personality.traits.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Personality
          </h3>
          <div className="space-y-2">
            {personality.traits.map((trait, i) => (
              <p key={i} className="text-sm text-gray-300">
                • {trait}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Skills & Equipment */}
      <div className="grid grid-cols-2 gap-4">
        {template.skills.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Skills
            </h3>
            <div className="flex flex-wrap gap-1">
              {template.skills.map((skill) => (
                <Badge key={skill} variant="secondary" className="text-xs">
                  {skill}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {template.languages.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Languages
            </h3>
            <div className="flex flex-wrap gap-1">
              {template.languages.map((lang) => (
                <Badge key={lang} variant="outline" className="text-xs">
                  {lang}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Main Page Component
 */
const StarterCharacterSelectionPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  // Get campaign ID from query params (passed from CampaignDetailPage)
  const campaignId = searchParams.get('campaignId');

  const { campaign, isLoading: campaignLoading } = useStarterCampaign(slug);
  const { templates, isLoading: templatesLoading } = useStarterCharacterTemplates(campaign?.id);

  const [selectedTemplate, setSelectedTemplate] = useState<StarterCharacterTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const isLoading = campaignLoading || templatesLoading;

  /**
   * Create character from template and start game
   */
  const handleStartWithCharacter = async () => {
    if (!selectedTemplate || !user || !campaignId || !campaign) return;

    setIsCreating(true);

    try {
      // Create character from template (using correct schema columns)
      const { data: character, error: charError } = await supabase
        .from('characters')
        .insert({
          user_id: user.id,
          name: selectedTemplate.name,
          race: selectedTemplate.race,
          subrace: selectedTemplate.subrace,
          class: selectedTemplate.class,
          level: selectedTemplate.level,
          background: selectedTemplate.background,
          backstory_elements: selectedTemplate.adaptedBackstory,
          description: selectedTemplate.tagline,
          campaign_id: campaignId,
          skill_proficiencies: selectedTemplate.skills.join(', '),
          languages: selectedTemplate.languages,
          image_url: selectedTemplate.portraitUrl,
        })
        .select('id')
        .single();

      if (charError) {
        logger.error('Error creating character:', charError);
        throw charError;
      }

      // Create character stats (ability scores are in a separate table)
      const { error: statsError } = await supabase.from('character_stats').insert({
        character_id: character.id,
        strength: selectedTemplate.abilityScores.strength,
        dexterity: selectedTemplate.abilityScores.dexterity,
        constitution: selectedTemplate.abilityScores.constitution,
        intelligence: selectedTemplate.abilityScores.intelligence,
        wisdom: selectedTemplate.abilityScores.wisdom,
        charisma: selectedTemplate.abilityScores.charisma,
        max_hit_points: 10 + Math.floor((selectedTemplate.abilityScores.constitution - 10) / 2),
        current_hit_points: 10 + Math.floor((selectedTemplate.abilityScores.constitution - 10) / 2),
        armor_class: 10 + Math.floor((selectedTemplate.abilityScores.dexterity - 10) / 2),
      });

      if (statsError) {
        logger.error('Error creating character stats:', statsError);
        // Don't throw - character was created, stats are optional for now
      }

      toast({
        title: 'Adventure Begins!',
        description: `${selectedTemplate.name} is ready for action.`,
      });

      // Navigate to game with correct URL format
      // GameContent expects: /app/game/{campaignId}?character={characterId}&starterCampaign={starterCampaignId}
      navigate(
        `/app/game/${campaignId}?character=${character.id}&starterCampaign=${campaign.id}&new=true`
      );
    } catch (err) {
      logger.error('Error starting with character:', err);
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
   * Navigate to character wizard for custom character
   */
  const handleCreateCustom = () => {
    if (!campaignId || !campaign) return;
    navigate(`/app/characters/create?campaign=${campaignId}&starterCampaign=${campaign.id}`);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-500/30" />
          <p className="text-gray-400">Loading characters...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (!campaign || !campaignId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-center px-6">
          <h1 className="text-4xl font-bold text-white mb-4">Something Went Wrong</h1>
          <p className="text-gray-400 mb-8">Could not load character options.</p>
          <Link to={`/explore/${slug}`} className="text-purple-400 hover:text-purple-300 underline">
            Return to Campaign
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Choose Your Character | {campaign.title} | Infinite Realms</title>
      </Helmet>

      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900">
        {/* Header */}
        <div className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-20">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <Link
                  to={`/explore/${slug}`}
                  className="text-gray-400 hover:text-white text-sm flex items-center gap-1 mb-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 19l-7-7m0 0l7-7m-7 7h18"
                    />
                  </svg>
                  Back to {campaign.title}
                </Link>
                <h1 className="text-2xl font-bold text-white">Choose Your Character</h1>
              </div>
              <Button
                onClick={handleCreateCustom}
                variant="outline"
                className="border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Create Custom Character
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="grid lg:grid-cols-[1fr,400px] gap-8">
            {/* Character Grid */}
            <div>
              <p className="text-gray-400 mb-6">
                Select a pre-built character tailored for {campaign.title}, or create your own
                custom character.
              </p>

              {templates.length === 0 ? (
                <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700">
                  <User className="w-12 h-12 mx-auto text-gray-500 mb-4" />
                  <p className="text-gray-400 mb-4">No pre-built characters available yet.</p>
                  <Button onClick={handleCreateCustom} variant="outline">
                    Create Custom Character
                  </Button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {templates.map((template) => (
                    <CharacterCard
                      key={template.id}
                      template={template}
                      isSelected={selectedTemplate?.id === template.id}
                      onSelect={() => setSelectedTemplate(template)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Details Panel */}
            <div className="lg:sticky lg:top-24 lg:self-start">
              {selectedTemplate ? (
                <>
                  <CharacterDetailsPanel template={selectedTemplate} />
                  <div className="mt-4 flex gap-3">
                    <Button
                      onClick={handleStartWithCharacter}
                      disabled={isCreating}
                      className="flex-1 bg-gradient-to-r from-purple-600 to-amber-600 hover:from-purple-500 hover:to-amber-500 text-white py-6 text-lg font-semibold rounded-xl shadow-lg shadow-purple-500/30"
                    >
                      {isCreating ? (
                        'Creating...'
                      ) : (
                        <>
                          Start Adventure
                          <ChevronRight className="w-5 h-5 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="bg-gray-800/50 rounded-xl p-8 border border-gray-700 text-center">
                  <User className="w-16 h-16 mx-auto text-gray-500 mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">Select a Character</h3>
                  <p className="text-gray-400 text-sm">
                    Click on a character card to see their full details and backstory.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default StarterCharacterSelectionPage;
