import React from 'react';

import { wizardSteps } from '../wizard/constants';

import SharedProgressIndicator from '@/components/shared/ProgressIndicator';

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  /** Step list for the track. Defaults to the full wizard list; pass the
   *  filtered list so the track names match the step counter (#210 QA-007). */
  steps?: { label: string }[];
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  currentStep,
  totalSteps,
  steps = wizardSteps,
}) => {
  return (
    <SharedProgressIndicator
      currentStep={currentStep}
      totalSteps={totalSteps}
      steps={steps}
      title="Character Creation Progress"
    />
  );
};

export default ProgressIndicator;
