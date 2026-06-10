/**
 * Scene Creation Wizard Component
 *
 * Multi-step wizard for creating new scenes with:
 * - Step 1: Name and description
 * - Step 2: Dimensions (width × height)
 * - Step 3: Grid type and size
 * - Step 4: Background image upload
 * - Step 5: Settings (fog of war, lighting, etc.)
 */

import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import React, { useState } from 'react';

import { StepBackgroundImage } from './scene-creation-wizard/StepBackgroundImage';
import { StepDimensions } from './scene-creation-wizard/StepDimensions';
import { StepGridSettings } from './scene-creation-wizard/StepGridSettings';
import { StepNameDescription } from './scene-creation-wizard/StepNameDescription';
import { StepSceneSettings } from './scene-creation-wizard/StepSceneSettings';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { Z_INDEX } from '@/constants/z-index';
import { trpc } from '@/infrastructure/api/trpc-client';
import { cn } from '@/lib/utils';
import { GridType } from '@/types/scene';

interface SceneCreationWizardProps {
  campaignId: string;
  onComplete?: (sceneId: string) => void;
  onCancel?: () => void;
}

interface SceneFormData {
  name: string;
  description: string;
  width: number;
  height: number;
  gridSize: number;
  gridType: GridType;
  gridColor: string;
  backgroundImageUrl: string;
  thumbnailUrl: string;
  enableFogOfWar: boolean;
  enableDynamicLighting: boolean;
  snapToGrid: boolean;
  gridOpacity: string;
  ambientLightLevel: string;
  darknessLevel: string;
  weatherEffects: string;
  timeOfDay: string;
}

const STEPS = [
  { title: 'Name & Description', description: 'Basic scene information' },
  { title: 'Dimensions', description: 'Set map size in squares' },
  { title: 'Grid Settings', description: 'Choose grid type and size' },
  { title: 'Background Image', description: 'Upload map image' },
  { title: 'Scene Settings', description: 'Configure lighting and effects' },
];

const DEFAULT_FORM_DATA: SceneFormData = {
  name: '',
  description: '',
  width: 20,
  height: 20,
  gridSize: 5,
  gridType: GridType.SQUARE,
  gridColor: '#000000',
  backgroundImageUrl: '',
  thumbnailUrl: '',
  enableFogOfWar: true,
  enableDynamicLighting: false,
  snapToGrid: true,
  gridOpacity: '0.30',
  ambientLightLevel: '1.00',
  darknessLevel: '0.00',
  weatherEffects: '',
  timeOfDay: 'day',
};

export const SceneCreationWizard: React.FC<SceneCreationWizardProps> = ({
  campaignId,
  onComplete,
  onCancel,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<SceneFormData>(DEFAULT_FORM_DATA);
  const { toast } = useToast();

  // Create scene mutation
  const createSceneMutation = trpc.scenes.create.useMutation({
    onSuccess: async (scene) => {
      // Update settings if needed
      if (currentStep === STEPS.length - 1) {
        await updateSettingsMutation.mutateAsync({
          sceneId: scene.id,
          settings: {
            enableFogOfWar: formData.enableFogOfWar,
            enableDynamicLighting: formData.enableDynamicLighting,
            snapToGrid: formData.snapToGrid,
            gridOpacity: formData.gridOpacity,
            ambientLightLevel: formData.ambientLightLevel,
            darknessLevel: formData.darknessLevel,
            weatherEffects: formData.weatherEffects || undefined,
            timeOfDay: formData.timeOfDay || undefined,
          },
        });
      }

      toast({
        title: 'Scene Created',
        description: 'Your new scene has been successfully created.',
      });
      onComplete?.(scene.id);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create scene.',
        variant: 'destructive',
      });
    },
  });

  const updateSettingsMutation = trpc.scenes.updateSettings.useMutation();

  const updateFormData = (updates: Partial<SceneFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0:
        if (!formData.name.trim()) {
          toast({
            title: 'Name Required',
            description: 'Please enter a name for your scene.',
            variant: 'destructive',
          });
          return false;
        }
        return true;
      case 1:
        if (
          formData.width < 1 ||
          formData.width > 100 ||
          formData.height < 1 ||
          formData.height > 100
        ) {
          toast({
            title: 'Invalid Dimensions',
            description: 'Width and height must be between 1 and 100.',
            variant: 'destructive',
          });
          return false;
        }
        return true;
      case 2:
        if (formData.gridSize < 1 || formData.gridSize > 50) {
          toast({
            title: 'Invalid Grid Size',
            description: 'Grid size must be between 1 and 50.',
            variant: 'destructive',
          });
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) {
      return;
    }

    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleFinish = () => {
    if (!validateStep(currentStep)) {
      return;
    }

    createSceneMutation.mutate({
      name: formData.name,
      description: formData.description || undefined,
      campaignId,
      width: formData.width,
      height: formData.height,
      gridSize: formData.gridSize,
      gridType: formData.gridType,
      gridColor: formData.gridColor,
      backgroundImageUrl: formData.backgroundImageUrl || '',
      thumbnailUrl: formData.thumbnailUrl || '',
    });
  };

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="max-w-4xl mx-auto">
      <Card variant="parchment">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <CardTitle className="text-2xl">Create New Scene</CardTitle>
              <CardDescription>
                {STEPS[currentStep].title} - {STEPS[currentStep].description}
              </CardDescription>
            </div>
            {onCancel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onCancel}
                    aria-label="Close scene creation wizard"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Close scene creation wizard</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Progress Indicator */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                Step {currentStep + 1} of {STEPS.length}
              </span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" aria-label="Creation progress" />
          </div>

          {/* Step Indicators */}
          <div className="flex items-center justify-between mt-4">
            {STEPS.map((step, index) => (
              <div
                key={index}
                className={cn(
                  'flex flex-col items-center gap-2 flex-1',
                  index < STEPS.length - 1 &&
                    'relative after:absolute after:top-5 after:left-[60%] after:w-full after:h-0.5 after:bg-border',
                )}
              >
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all relative',
                    index < currentStep && 'bg-electricCyan text-white',
                    index === currentStep &&
                      'bg-infinite-purple text-white ring-4 ring-infinite-purple/20',
                    index > currentStep && 'bg-muted text-muted-foreground',
                  )}
                  style={{ zIndex: Z_INDEX.DROPDOWN }}
                  aria-label={`Step ${index + 1}: ${step.title} - ${
                    index < currentStep ? 'Completed' : index === currentStep ? 'Current' : 'Upcoming'
                  }`}
                >
                  {index < currentStep ? <Check className="h-5 w-5" /> : index + 1}
                </div>
                <span className="text-xs text-center hidden sm:block">{step.title}</span>
              </div>
            ))}
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          {/* Step 1: Name & Description */}
          {currentStep === 0 && (
            <StepNameDescription
              name={formData.name}
              description={formData.description}
              onUpdate={updateFormData}
            />
          )}

          {/* Step 2: Dimensions */}
          {currentStep === 1 && (
            <StepDimensions
              width={formData.width}
              height={formData.height}
              gridSize={formData.gridSize}
              onUpdate={updateFormData}
            />
          )}

          {/* Step 3: Grid Settings */}
          {currentStep === 2 && (
            <StepGridSettings
              gridType={formData.gridType}
              gridSize={formData.gridSize}
              gridColor={formData.gridColor}
              onUpdate={updateFormData}
            />
          )}

          {/* Step 4: Background Image */}
          {currentStep === 3 && (
            <StepBackgroundImage
              campaignId={campaignId}
              width={formData.width}
              height={formData.height}
              gridSize={formData.gridSize}
              backgroundImageUrl={formData.backgroundImageUrl}
              onUpdate={updateFormData}
            />
          )}

          {/* Step 5: Scene Settings */}
          {currentStep === 4 && (
            <StepSceneSettings
              enableFogOfWar={formData.enableFogOfWar}
              enableDynamicLighting={formData.enableDynamicLighting}
              snapToGrid={formData.snapToGrid}
              gridOpacity={formData.gridOpacity}
              ambientLightLevel={formData.ambientLightLevel}
              darknessLevel={formData.darknessLevel}
              weatherEffects={formData.weatherEffects}
              timeOfDay={formData.timeOfDay}
              onUpdate={updateFormData}
            />
          )}
        </CardContent>

        {/* Navigation Buttons */}
        <div className="px-6 pb-6">
          <div className="flex items-center justify-between pt-6 border-t">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentStep === 0 || createSceneMutation.isLoading}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Previous
            </Button>

            <div className="flex gap-2">
              {onCancel && (
                <Button variant="ghost" onClick={onCancel} disabled={createSceneMutation.isLoading}>
                  Cancel
                </Button>
              )}
              <Button
                variant="cosmic"
                onClick={handleNext}
                disabled={createSceneMutation.isLoading}
              >
                {currentStep === STEPS.length - 1 ? (
                  <>
                    {createSceneMutation.isLoading ? (
                      'Creating...'
                    ) : (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Finish
                      </>
                    )}
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};
