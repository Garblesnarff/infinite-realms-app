import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { wizardSteps } from '../../wizard/constants';
import ProgressIndicator from '../ProgressIndicator';

// QA-053 (supersedes QA-007): the old QA-007 fix built the track from the
// filtered step list so the names matched the counter — but the counter
// itself was the bug: the total jumped 12 -> 13 -> 14 as Subrace,
// Personality and Advanced Spellcasting appeared. The track now always
// shows the full 16-step list with a stable total; steps not on the current
// path render greyed.
describe('wizard ProgressIndicator (QA-053)', () => {
  it('renders the full wizard step list with a stable total of 16', () => {
    const { getAllByText, getByText } = render(
      <ProgressIndicator currentStep={0} totalSteps={wizardSteps.length} />,
    );
    // The label appears both in the desktop track and the current-step readout.
    expect(getAllByText('Basic Info').length).toBeGreaterThan(0);
    expect(getAllByText('Subrace').length).toBeGreaterThan(0);
    expect(getByText('1 of 16')).toBeDefined();
  });

  it('keeps skipped steps in the track while the total stays 16', () => {
    // A human has no subraces: Subrace is skipped, not hidden.
    const { queryByText, getByText } = render(
      <ProgressIndicator currentStep={0} totalSteps={16} steps={wizardSteps} skippedSteps={[2]} />,
    );
    expect(queryByText('Subrace')).not.toBeNull();
    expect(getByText('1 of 16')).toBeDefined();
  });

  it('does not fill the dot of a skipped step before the current one', () => {
    const { container } = render(
      <ProgressIndicator currentStep={3} totalSteps={16} steps={wizardSteps} skippedSteps={[2]} />,
    );
    const dots = container.querySelectorAll('div.w-2.h-2.rounded-full');
    expect(dots.length).toBe(16);
    // Skipped Subrace (index 2) stays muted; the current step (index 3) fills.
    expect(dots[2]?.className).toContain('bg-muted-foreground/30');
    expect(dots[3]?.className).toContain('bg-primary');
  });
});
