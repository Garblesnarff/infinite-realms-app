import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SpellCard } from '../SpellCard';

import type { Spell } from '@/types/character';

const bonusActionSpell: Spell = {
  id: 'field-check-bonus-action',
  name: 'Field Check Bonus Action',
  level: 2,
  school: 'Transmutation',
  casting_time: '1 bonus action',
  range_text: '60 feet',
  components: 'V, S',
  duration: '1 minute',
  description: 'A distinctive spell used to prove casting_time and range_text render.',
};

describe('SpellCard renders the casting_time and range_text fields', () => {
  it('shows both field values in the visible spell details line', () => {
    render(<SpellCard spell={bonusActionSpell} isSelected={false} onSelectionChange={vi.fn()} />);

    expect(screen.getByText(/1 bonus action/)).toBeInTheDocument();
    expect(screen.getByText(/60 feet/)).toBeInTheDocument();
  });
});
