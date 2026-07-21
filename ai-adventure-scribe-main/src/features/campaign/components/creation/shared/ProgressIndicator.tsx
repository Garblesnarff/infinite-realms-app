import { CheckCircle, Circle, Wand2, Map, Settings, Sparkles } from 'lucide-react';
import React from 'react';

import { wizardSteps } from '../wizard/constants';

import SharedProgressIndicator from '@/components/shared/ProgressIndicator';

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

const campaignTheme = {
  title: 'text-lg font-semibold text-foreground',
  badge: 'px-3 py-1 border-infinite-gold/40 text-infinite-gold',
  progressBarGradient: 'from-infinite-gold to-infinite-purple',
  stepPreviewCard: 'p-4 bg-card border border-border',
  currentStepText: 'font-medium text-infinite-gold',
  currentStepDot: 'bg-infinite-gold',
  currentStepLabel: 'text-infinite-gold font-semibold',
};

const renderCampaignStepIcon = (stepIndex: number, isCompleted: boolean, isCurrent: boolean) => {
  if (isCompleted) {
    return <CheckCircle className="w-4 h-4 text-success" />;
  }
  if (isCurrent) {
    // Return the specific icon for the current step
    switch (stepIndex) {
      case 0:
        return <Wand2 className="w-4 h-4 text-infinite-gold" />;
      case 1:
        return <Map className="w-4 h-4 text-infinite-gold" />;
      case 2:
        return <Settings className="w-4 h-4 text-infinite-gold" />;
      case 3:
        return <Sparkles className="w-4 h-4 text-infinite-gold" />;
      default:
        return <Circle className="w-4 h-4 text-infinite-gold fill-infinite-gold" />;
    }
  }
  // For upcoming steps, show a simple circle
  return <Circle className="w-4 h-4" />;
};

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ currentStep, totalSteps }) => {
  return (
    <SharedProgressIndicator
      currentStep={currentStep}
      totalSteps={totalSteps}
      steps={wizardSteps}
      title="Campaign Creation Progress"
      theme={campaignTheme}
      renderStepIcon={renderCampaignStepIcon}
    />
  );
};

export default ProgressIndicator;
