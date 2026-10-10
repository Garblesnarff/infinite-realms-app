import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { wizardSteps } from '../../wizard/constants';
import ProgressIndicator from '../ProgressIndicator';

// QA-007: the wizard step track listed all 14 step names while the indicator
// said "1 of 12". The track must be built from the same filtered step list as
// the counter.
describe('wizard ProgressIndicator (QA-007)', () => {
  it('defaults to the full wizard step list', () => {
    const { getAllByText, getByText } = render(<ProgressIndicator currentStep={0} totalSteps={12} />);
    // The label appears both in the desktop track and the current-step readout.
    expect(getAllByText('Basic Info').length).toBeGreaterThan(0);
    expect(getByText('1 of 12')).toBeDefined();
  });

  it('renders the provided filtered step list in the track', () => {
    const filtered = wizardSteps.filter((step) => step.label !== 'Subrace');
    const { queryByText, getAllByText, getByText } = render(
      <ProgressIndicator currentStep={0} totalSteps={filtered.length} steps={filtered} />,
    );
    expect(queryByText('Subrace')).toBeNull();
    expect(getAllByText('Basic Info').length).toBeGreaterThan(0);
    expect(getByText(`1 of ${filtered.length}`)).toBeDefined();
  });
});
