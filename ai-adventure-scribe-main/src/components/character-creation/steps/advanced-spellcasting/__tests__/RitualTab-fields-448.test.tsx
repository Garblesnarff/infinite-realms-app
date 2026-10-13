import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RitualTab } from '../RitualTab';

import type { Spell } from '@/types/character';

import { Tabs } from '@/components/ui/tabs';

const ritualSpell: Spell = {
  id: 'field-check-ritual',
  name: 'Field Check Ritual',
  level: 1,
  school: 'Divination',
  casting_time: '7 minutes',
  range_text: 'Self (15-foot radius)',
  components: 'V, S',
  duration: 'Instantaneous',
  description: 'A distinctive ritual used to prove casting_time and range_text render.',
  ritual: true,
};

describe("RitualTab renders each ritual spell's casting_time and range_text", () => {
  it('shows both field values in the visible spell details line', () => {
    render(
      <Tabs value="ritual">
        <RitualTab characterClassId="wizard" availableRitualSpells={[ritualSpell]} />
      </Tabs>,
    );

    expect(screen.getByText(/7 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/Self \(15-foot radius\)/)).toBeInTheDocument();
  });
});
