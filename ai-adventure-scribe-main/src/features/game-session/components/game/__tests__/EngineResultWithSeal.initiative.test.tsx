import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { initiativeCard } from '../../../../../../shared/engine-result-card';
import { EngineResultWithSeal } from '../EngineResultWithSeal';

// The seating card built from seated participants, as the entry response carries them (#1521).
const seated = [
  { id: 'scholar', name: 'Scholar', participantType: 'player', initiative: 5, turnOrder: 1 },
  {
    id: 'stalker-2',
    name: 'Faceless Stalker 2',
    participantType: 'monster',
    initiative: 15,
    turnOrder: 0,
  },
  {
    id: 'stalker-1',
    name: 'Faceless Stalker 1',
    participantType: 'monster',
    initiative: 11,
    turnOrder: 2,
  },
];

describe('initiative card seal (#1521)', () => {
  it('seals the seating card slate with the player initiative total in Table look', () => {
    const card = initiativeCard(
      seated,
      'Initiative: 5 (nat 4+1) — Faceless Stalker 2: 15 + 0 = 15.',
    );
    if (!card) throw new Error('the seated initiative card must build');
    document.body.classList.add('ir-table-look');
    try {
      render(<EngineResultWithSeal card={card} showTargetNumbers={false} />);
      const seal = screen.getByTestId('engine-roll-seal');
      expect(seal).toHaveAttribute('data-seal-tone', 'slate');
      expect(seal).toHaveTextContent(/^5$/);
    } finally {
      document.body.classList.remove('ir-table-look');
    }
  });
});
