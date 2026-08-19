import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EngineOutcomeChip, summarizeEngineLine } from '../EngineOutcomeChip';

const LINE =
  '⚙️ Engine: The Storyteller rolled 16 + 4 = 20 vs AC 12 against Dishwasher Prime with Rapier — HIT. 8 piercing damage.';

describe('EngineOutcomeChip', () => {
  it('summarises the trust-layer line without the raw prefix', () => {
    expect(summarizeEngineLine(LINE)).toEqual({
      outcome: 'HIT',
      detail:
        'The Storyteller rolled 16 + 4 = 20 vs AC 12 against Dishwasher Prime with Rapier — HIT. 8 piercing damage.',
    });
  });

  it('renders a default-open chip labelled Engine, not the ⚙️ prefix', () => {
    render(<EngineOutcomeChip line={LINE} />);
    expect(screen.getByText('Engine')).toBeInTheDocument();
    expect(screen.getByText('HIT')).toBeInTheDocument();
    expect(screen.queryByText(/⚙️/)).not.toBeInTheDocument();
    expect(screen.getByText(/16 \+ 4 = 20 vs AC 12/)).toBeInTheDocument();
  });
});
