import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CampaignWizard from './campaign-wizard';

// Mock WizardContent
vi.mock('./wizard/WizardContent', () => ({
  default: () => <div data-testid="mocked-wizard-content">Mocked Wizard Content</div>,
}));

describe('CampaignWizard', () => {
  it('renders WizardContent', () => {
    render(<CampaignWizard />);
    expect(screen.getByTestId('mocked-wizard-content')).toBeInTheDocument();
  });
});
