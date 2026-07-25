import { useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import { trpc } from '@/infrastructure/api/trpc-client';
import { GridType } from '@/types/scene';

export interface SceneFormData {
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

export const STEPS = [
  { title: 'Name & Description', description: 'Basic scene information' },
  { title: 'Dimensions', description: 'Set map size in squares' },
  { title: 'Grid Settings', description: 'Choose grid type and size' },
  { title: 'Background Image', description: 'Upload map image' },
  { title: 'Scene Settings', description: 'Configure lighting and effects' },
];

export const DEFAULT_FORM_DATA: SceneFormData = {
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

interface UseSceneCreationWizardProps {
  campaignId: string;
  onComplete?: (sceneId: string) => void;
  onCancel?: () => void;
}

export const useSceneCreationWizard = ({
  campaignId,
  onComplete,
  onCancel,
}: UseSceneCreationWizardProps) => {
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

  return {
    currentStep,
    formData,
    progress,
    isLoading: createSceneMutation.isLoading,
    updateFormData,
    handleNext,
    handlePrevious,
    handleFinish,
    STEPS,
  };
};
