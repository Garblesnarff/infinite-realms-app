/* eslint-disable max-lines */
import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { wizardSteps } from './constants';
import { validateStep, validateCharacterForSave } from './wizard-validators';
import CharacterPreview from '../shared/CharacterPreview';
import ProgressIndicator from '../shared/ProgressIndicator';
import StepNavigation from '../shared/StepNavigation';

import { Card } from '@/components/ui/card';
import { useCharacter } from '@/contexts/CharacterContext';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useCharacterSave } from '@/hooks/use-character-save';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { analytics } from '@/services/analytics';

/**
 * Main content component for the character creation wizard
 * Handles step navigation, validation, and character saving
 */
const WizardContent: React.FC = () => {
  const { state } = useCharacter();
  const [currentStep, setCurrentStep] = React.useState(0);
  const { saveCharacter, isSaving } = useCharacterSave();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { scrollToTop } = useAutoScroll();
  const [searchParams] = useSearchParams();

  // Filter steps based on character state
  const getFilteredSteps = React.useCallback(() => {
    return wizardSteps.filter((step) => {
      if (step.skipCondition) {
        return !step.skipCondition(state.character);
      }
      return true;
    });
  }, [state.character]);

  const filteredSteps = getFilteredSteps();

  // Adjust current step if steps are filtered and current step is out of bounds
  React.useEffect(() => {
    if (currentStep >= filteredSteps.length && filteredSteps.length > 0) {
      setCurrentStep(filteredSteps.length - 1);
    }
  }, [filteredSteps.length, currentStep]);

  // Scroll to top whenever the step changes
  React.useEffect(() => {
    scrollToTop();
  }, [currentStep, scrollToTop]);

  /**
   * Handles navigation to the next step
   * Validates current step before proceeding, on final step validates and saves the complete character
   * @returns {Promise<void>}
   */
  const handleNext = async () => {
    logger.debug('handleNext called at step:', currentStep);
    logger.debug('Current step info:', filteredSteps[currentStep]);

    // Enhanced error boundary for navigation
    try {
      if (currentStep < filteredSteps.length - 1) {
        // Validate current step before proceeding
        const validation = state.character
          ? validateStep(filteredSteps[currentStep]?.label || '', state.character)
          : { isValid: false, message: 'No character data found' };
        logger.debug('Step validation result:', validation);

        if (!validation.isValid) {
          // Show a gentler warning for spell-related validation
          const isSpellStep = filteredSteps[currentStep]?.label === 'Spells';
          if (isSpellStep) {
            toast({
              title: 'Spell Selection Incomplete',
              description: validation.message + ' You can continue and complete this later.',
              variant: 'default',
            });
            // Allow proceeding despite incomplete spells
          } else {
            toast({
              title: 'Please Complete This Step',
              description: validation.message,
              variant: 'destructive',
            });
            return; // Don't proceed if validation fails for non-spell steps
          }
        }

        // Find the next valid step (accounting for filtered steps)
        const nextStepIndex = currentStep + 1;
        logger.info('Navigating to next step:', nextStepIndex);

        // Enhanced safety check: ensure the next step exists in filtered steps
        if (nextStepIndex < filteredSteps.length && filteredSteps[nextStepIndex]) {
          setCurrentStep(nextStepIndex);
        } else {
          logger.error(
            'Next step does not exist in filtered steps:',
            nextStepIndex,
            filteredSteps.length,
          );
          toast({
            title: 'Navigation Error',
            description:
              'Unable to navigate to the next step. The wizard may need to be restarted.',
            variant: 'destructive',
          });
          // Attempt recovery by resetting to the last valid step
          const lastValidStep = Math.max(0, filteredSteps.length - 1);
          if (currentStep !== lastValidStep) {
            setCurrentStep(lastValidStep);
          }
        }
      } else {
        logger.info('Final step - attempting to save character');

        // Enhanced character existence check
        if (!state.character) {
          logger.error('No character data to save');
          toast({
            title: 'No Character Data',
            description:
              'Character data appears to be missing. Please restart the character creation process.',
            variant: 'destructive',
          });
          return;
        }

        // Enhanced validation with detailed feedback
        logger.debug('Character data for save:', state.character);
        const isValid = validateCharacterForSave(state.character);
        logger.debug('Character validation result:', isValid);

        if (!isValid) {
          // Check for critical missing fields
          const criticalMissing = [];
          if (!state.character.name?.trim()) criticalMissing.push('name');
          if (!state.character.race) criticalMissing.push('race');
          if (!state.character.class) criticalMissing.push('class');
          if (!state.character.background) criticalMissing.push('background');
          if (!state.character.abilityScores) criticalMissing.push('ability scores');

          if (criticalMissing.length > 0) {
            toast({
              title: 'Critical Fields Missing',
              description: `Please complete these required fields: ${criticalMissing.join(', ')}. Character cannot be saved without them.`,
              variant: 'destructive',
            });
            return;
          } else {
            toast({
              title: 'Character Validation Issues',
              description:
                'Some optional fields are incomplete. You can still save and edit later, or complete the missing sections.',
              variant: 'default',
            });
          }
        }

        // Enhanced save with better error handling
        try {
          logger.info('Calling saveCharacter...');
          const savedCharacter = await saveCharacter(state.character);
          logger.debug('Save result:', savedCharacter);

          if (!savedCharacter) {
            logger.warn('Character save returned null; staying on wizard step for user correction');
            return;
          }

          if (savedCharacter.id) {
            logger.info('Character saved successfully, navigating to /characters');
            try {
              const campaignId = searchParams.get('campaign') || undefined;
              const artStyle = analytics.detectArtStyle({
                characterTheme: state.character?.theme,
                campaignGenre: undefined,
              });
              analytics.characterCreationCompleted({ campaignId, artStyle });
            } catch (_e) {
              // ignore analytics errors
            }
            toast({
              title: 'Success!',
              description:
                'Character created successfully! Background image generation may continue in the background.',
            });
            const targetCampaignId = savedCharacter.campaign_id || state.character?.campaign_id;
            const starterCampaignId = searchParams.get('starterCampaign');

            // If this is a starter campaign, navigate directly to the game
            if (starterCampaignId && targetCampaignId && savedCharacter.id) {
              navigate(
                `/app/game/${targetCampaignId}?character=${savedCharacter.id}&starterCampaign=${starterCampaignId}`,
              );
            } else if (targetCampaignId) {
              navigate(`/app/campaigns/${targetCampaignId}/characters`);
            } else {
              navigate('/app/characters');
            }
          } else {
            logger.error('Save succeeded but no ID returned');
            toast({
              title: 'Save Warning',
              description:
                'Character data may be incomplete. Please review your characters list and edit if needed.',
              variant: 'destructive',
            });
          }
        } catch (error) {
          logger.error('Error saving character:', error);

          // Enhanced error message with recovery suggestions
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const isNetworkError =
            errorMessage.toLowerCase().includes('network') ||
            errorMessage.toLowerCase().includes('fetch') ||
            errorMessage.toLowerCase().includes('connection');

          toast({
            title: 'Save Error',
            description: isNetworkError
              ? `Network connection issue: ${errorMessage}. Please check your internet connection and try again.`
              : `Failed to save character: ${errorMessage}. Please try again or contact support if the issue persists.`,
            variant: 'destructive',
          });
        }
      }
    } catch (unexpectedError) {
      // Catch-all error handler for any unexpected errors in navigation
      logger.error('Unexpected error in handleNext:', unexpectedError);
      toast({
        title: 'Unexpected Error',
        description:
          'An unexpected error occurred during navigation. Please refresh the page and try again.',
        variant: 'destructive',
      });
    }
  };

  /**
   * Handles navigation to the previous step
   * Allows users to move backwards through the creation process
   */
  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Get the component for the current step
  const CurrentStepComponent = filteredSteps[currentStep]?.component;

  // Handle case where no steps are available
  if (!CurrentStepComponent) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card className="p-6 glass-strong">
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-4">Character Creation</h1>
            <p className="text-muted-foreground">Loading character creation steps...</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[image:var(--gradient-cosmic)]">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Main Character Creation Area */}
          <div className="xl:col-span-2">
            <Card className="p-6 glass-strong rounded-2xl hover-lift shadow-xl border-2 border-white/20">
              <h1 className="text-3xl font-bold text-center mb-8 bg-gradient-to-r from-infinite-purple via-infinite-gold to-infinite-teal bg-clip-text text-transparent">
                Create Your Character
              </h1>
              <ProgressIndicator currentStep={currentStep} totalSteps={filteredSteps.length} />
              <div className="min-h-[600px] transition-all duration-500 ease-in-out">
                <div
                  key={currentStep}
                  className="animate-in fade-in slide-in-from-right-4 duration-500"
                >
                  <CurrentStepComponent />
                </div>
              </div>
              <StepNavigation
                currentStep={currentStep}
                totalSteps={filteredSteps.length}
                onNext={handleNext}
                onPrevious={handlePrevious}
                isLoading={isSaving}
              />
            </Card>
          </div>

          {/* Character Preview Sidebar */}
          <div className="xl:col-span-1">
            <div className="sticky top-8 transition-all duration-300">
              <CharacterPreview />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WizardContent;
