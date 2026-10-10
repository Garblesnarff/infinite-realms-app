import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { wizardSteps } from './constants';
import { saveCharacterAndNavigate } from './save-character-and-navigate';
import { useWizardDraft } from './use-wizard-draft';
import { hasWizardDraftData, type WizardDraft } from './wizard-draft';
import { validateStep, validateCharacterForSave } from './wizard-validators';
import CharacterPreview from '../shared/CharacterPreview';
import ProgressIndicator from '../shared/ProgressIndicator';
import StepNavigation from '../shared/StepNavigation';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { initialState as initialCharacterState } from '@/contexts/character/character-reducer';
import { useCharacter } from '@/contexts/CharacterContext';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useCharacterSave } from '@/hooks/use-character-save';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';

/** URL param carrying the wizard step, so browser Back/Forward moves one step. */
const STEP_PARAM = 'step';

function readStepParam(searchParams: URLSearchParams): number {
  const raw = searchParams.get(STEP_PARAM);
  if (raw === null) return 0;
  // Bounded at parse time; the sync effect clamps to the filtered step list too.
  return Math.max(0, Math.min(Number.parseInt(raw, 10) || 0, 9999));
}

function formatDraftDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'recently' : d.toLocaleString();
}

/**
 * Main content component for the character creation wizard
 * Handles step navigation, validation, and character saving
 */
const WizardContent: React.FC = () => {
  const { state, dispatch } = useCharacter();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentStep, setCurrentStep] = React.useState<number>(() => readStepParam(searchParams));
  const { saveCharacter, isSaving } = useCharacterSave();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { scrollToTop } = useAutoScroll();
  const [cancelDialogOpen, setCancelDialogOpen] = React.useState(false);

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

  /** Move to a step, recording it in the URL (new history entry by default). */
  const goToStep = React.useCallback(
    (step: number, opts?: { replace?: boolean }) => {
      setCurrentStep(step);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(STEP_PARAM, String(step));
          return next;
        },
        { replace: opts?.replace },
      );
    },
    [setSearchParams],
  );

  // Draft persistence (#208): autosave locally per user, offer resume on return.
  const { pendingDraft, resumeDraft, discardDraft, clearDraft } = useWizardDraft({
    character: state.character,
    currentStep,
    userId: user?.id ?? null,
    campaignId: searchParams.get('campaign'),
    onRestore: (draft: WizardDraft) => {
      dispatch({ type: 'SET_CHARACTER', payload: draft.character });
      goToStep(draft.step, { replace: true });
    },
  });

  const handleDiscardDraft = React.useCallback(() => {
    discardDraft();
    // Reset the form too: otherwise the stale character stays on screen and
    // the next edit would resurrect the "discarded" draft via autosave.
    dispatch({ type: 'SET_CHARACTER', payload: { ...initialCharacterState.character } });
    goToStep(0, { replace: true });
  }, [discardDraft, dispatch, goToStep]);

  // Ensure the step param exists on first mount (replace, no history entry).
  // The step state itself is initialized from the URL above.
  const didInitStepParam = React.useRef(false);
  React.useEffect(() => {
    if (didInitStepParam.current) return;
    didInitStepParam.current = true;
    if (searchParams.get(STEP_PARAM) === null) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(STEP_PARAM, '0');
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  // Sync the step from the URL (browser Back/Forward) and clamp to the
  // filtered step list.
  React.useEffect(() => {
    const maxStep = Math.max(0, filteredSteps.length - 1);
    const clamped = Math.min(readStepParam(searchParams), maxStep);
    setCurrentStep((prev) => (prev === clamped ? prev : clamped));
  }, [searchParams, filteredSteps.length]);

  // Warn before the tab is closed or refreshed while the draft has data.
  React.useEffect(() => {
    if (!hasWizardDraftData(state.character) || isSaving) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.character, isSaving]);

  // Scroll to top whenever the step changes
  React.useEffect(() => {
    scrollToTop();
  }, [currentStep, scrollToTop]);

  const handleCancelClick = () => {
    if (hasWizardDraftData(state.character)) {
      setCancelDialogOpen(true);
    } else {
      confirmCancel();
    }
  };

  const confirmCancel = () => {
    clearDraft();
    setCancelDialogOpen(false);
    navigate('/app/characters');
  };

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
          goToStep(nextStepIndex);
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
            goToStep(lastValidStep, { replace: true });
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
        await saveCharacterAndNavigate({
          character: state.character,
          saveCharacter,
          navigate,
          searchParams,
          toast,
          onSaved: () => clearDraft(),
        });
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
      goToStep(currentStep - 1);
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
              <ProgressIndicator
                currentStep={currentStep}
                totalSteps={filteredSteps.length}
                steps={filteredSteps}
              />
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
                onCancel={handleCancelClick}
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

      {/* Resume draft dialog (#208): explicit choice, not dismissible by backdrop */}
      <AlertDialog open={pendingDraft !== null}>
        <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume your character?</AlertDialogTitle>
            <AlertDialogDescription>
              You have an unfinished character draft
              {pendingDraft ? ` from ${formatDraftDate(pendingDraft.updatedAt)}` : ''}. Pick up
              where you left off, or start over.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscardDraft}>Start over</AlertDialogCancel>
            <AlertDialogAction onClick={resumeDraft}>Resume draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel confirm dialog (#208) */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel character creation?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unfinished draft will be discarded. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel}>Discard draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WizardContent;
