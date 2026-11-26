import React from 'react';

import { wizardSteps } from '../wizard/constants';

import SharedProgressIndicator from '@/components/shared/ProgressIndicator';

interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
  /** Step list for the track. Always the full wizard list: the total stays
   *  stable while skipConditions add or remove steps (#210 QA-053, which
   *  supersedes the QA-007 filtered-track premise — the old "1 of 12" fix
   *  made the track match the filtered counter, and the counter itself was
   *  the bug). Steps not on the current path arrive via skippedSteps and
   *  render greyed. currentStep is the position in the FULL list. */
  steps?: { label: string }[];
  /** Full-list indexes of steps not on the current path. */
  skippedSteps?: number[];
}

const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  currentStep,
  totalSteps,
  steps = wizardSteps,
  skippedSteps = [],
}) => {
  return (
    <SharedProgressIndicator
      currentStep={currentStep}
      totalSteps={totalSteps}
      steps={steps}
      skippedSteps={skippedSteps}
      title="Character Creation Progress"
    />
  );
};

export default ProgressIndicator;
