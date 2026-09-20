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

  it('keeps the Engine label and HIT badge as separate nodes with a gap', () => {
    render(<EngineOutcomeChip line={LINE} />);

    const label = screen.getByText('Engine');
    const badge = screen.getByText('HIT');

    expect(label).not.toBe(badge);
    expect(label.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.parentElement).toHaveClass('gap-2');
    expect(label.parentElement).toHaveAccessibleName('Engine HIT');
    expect(screen.queryByText('EngineHIT')).not.toBeInTheDocument();
  });

  it('renders AUTO-HIT and REFUSED badges from spell engine lines', () => {
    const { rerender } = render(
      <EngineOutcomeChip line="⚙️ Engine: Rook cast Magic Missile at Professor Umeboshi — AUTO-HIT. 8 force damage." />,
    );
    expect(screen.getByLabelText('Engine AUTO-HIT')).toBeInTheDocument();
    expect(screen.getByText('AUTO-HIT')).toBeInTheDocument();

    rerender(
      <EngineOutcomeChip line={'⚙️ Engine: Rook\'s spell "Meteor Swarm" was refused (unknown spell). No roll, no damage, no wound.'} />,
    );
    expect(screen.getByLabelText('Engine REFUSED')).toBeInTheDocument();
    expect(screen.getByText('REFUSED')).toBeInTheDocument();
  });

  it('keeps the Engine label and MISS badge as separate nodes', () => {
    render(
      <EngineOutcomeChip line="⚙️ Engine: The Storyteller rolled 2 + 4 = 6 vs AC 12 — MISS." />,
    );

    const label = screen.getByText('Engine');
    const badge = screen.getByText('MISS');
    expect(label).not.toBe(badge);
    expect(label.parentElement).toHaveAccessibleName('Engine MISS');
    expect(screen.queryByText('EngineMISS')).not.toBeInTheDocument();
  });
});
