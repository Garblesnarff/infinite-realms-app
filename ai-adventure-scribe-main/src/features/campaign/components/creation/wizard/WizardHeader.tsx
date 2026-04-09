import React from 'react';

import { useAutosave } from '@/hooks/useAutosave';

type Props = {
  step?: number;
  totalSteps?: number;
  autosaveKey?: string;
  formSnapshot?: any;
};

/**
 * Header component for the campaign creation wizard
 * Matches the character creation wizard styling
 */
const WizardHeader: React.FC<Props> = ({
  _step = 1,
  _totalSteps = 4,
  autosaveKey = 'campaign-wizard-draft',
  formSnapshot = {},
}) => {
  const { status: _status } = useAutosave(autosaveKey, formSnapshot, { delay: 900 });

  return (
    <div className="text-center mb-8">
      <h1 className="text-3xl font-bold">Create Your Campaign</h1>
    </div>
  );
};

export default WizardHeader;
