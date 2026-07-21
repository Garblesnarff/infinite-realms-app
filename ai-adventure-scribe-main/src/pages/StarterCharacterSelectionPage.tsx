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

import { Sparkles, User, ChevronRight } from 'lucide-react';
import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import type { StarterCharacterTemplate } from '@/hooks/use-starter-character-templates';

import { StarterCharacterCard } from '@/components/campaigns/StarterCharacterCard';
import { StarterCharacterDetails } from '@/components/campaigns/StarterCharacterDetails';
import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';
import { useAuth } from '@/contexts/AuthContext';
import { useStarterCampaign } from '@/hooks/use-starter-campaigns';
import { useStarterCharacterTemplates } from '@/hooks/use-starter-character-templates';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { seedStarterCharacter } from '@/services/character/starter-character-seeding';
import { userDataApi } from '@/services/user-data-api';

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
  const {
    templates,
    isLoading: templatesLoading,
    error: templatesError,
    retry: retryTemplates,
  } = useStarterCharacterTemplates(campaign?.id);

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
      const character = await seedStarterCharacter(selectedTemplate, campaignId, (payload) =>
        userDataApi.createCharacter(payload),
      );

      toast({
        title: 'Adventure Begins!',
        description: `${selectedTemplate.name} is ready for action.`,
      });

      // Navigate to game with correct URL format
      // GameContent expects: /app/game/{campaignId}?character={characterId}&starterCampaign={starterCampaignId}
      navigate(
        `/app/game/${campaignId}?character=${character.id}&starterCampaign=${campaign.id}&new=true`,
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-infinite-gold/30" />
          <p className="text-muted-foreground">Loading characters...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (!campaign || !campaignId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center px-6">
          <h1 className="text-4xl font-bold text-foreground mb-4">Something Went Wrong</h1>
          <p className="text-muted-foreground mb-8">Could not load character options.</p>
          <Link
            to={`/explore/${slug}`}
            className="text-infinite-gold hover:text-infinite-gold-light underline"
          >
            Return to Campaign
          </Link>
        </div>
      </div>
    );
  }

  if (templatesError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center px-6" role="alert">
          <h1 className="text-4xl font-bold text-foreground mb-4">Unable to Load Characters</h1>
          <p className="text-muted-foreground mb-8">
            Could not load character options. Please try again.
          </p>
          <Button onClick={retryTemplates}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Choose Your Character | {campaign.title} | Infinite Realms</title>
      </Helmet>

      <div className="min-h-screen bg-background">
        {/* Header */}
        <div
          className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0"
          style={{ zIndex: Z_INDEX.STICKY }}
        >
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <Link
                  to={`/explore/${slug}`}
                  className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 mb-1"
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
                <h1 className="text-2xl font-bold text-foreground">Choose Your Character</h1>
              </div>
              <Button
                onClick={handleCreateCustom}
                variant="outline"
                className="border-border bg-transparent text-muted-foreground hover:bg-secondary/20"
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
              <p className="text-muted-foreground mb-6">
                Select a pre-built character tailored for {campaign.title}, or create your own
                custom character.
              </p>

              {templates.length === 0 ? (
                <div className="text-center py-12 bg-card/30 rounded-xl border border-border">
                  <User className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground mb-4">No pre-built characters available yet.</p>
                  <Button onClick={handleCreateCustom} variant="outline" className="bg-transparent">
                    Create Custom Character
                  </Button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {templates.map((template) => (
                    <StarterCharacterCard
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
                  <StarterCharacterDetails template={selectedTemplate} />
                  <div className="mt-4 flex gap-3">
                    <Button
                      onClick={handleStartWithCharacter}
                      disabled={isCreating}
                      className="flex-1 bg-infinite-gold text-infinite-dark hover:bg-infinite-purple py-6 text-lg font-semibold rounded-xl shadow-lg shadow-infinite-gold/30"
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
                <div className="bg-card/50 rounded-xl p-8 border border-border text-center">
                  <User className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">Select a Character</h3>
                  <p className="text-muted-foreground text-sm">
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
