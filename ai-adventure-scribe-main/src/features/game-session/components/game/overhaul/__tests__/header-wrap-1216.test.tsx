import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LeftRail } from '../LeftRail';
import { MOCK_VIEW_MODEL } from '../mockData';
import { RightSheet } from '../RightSheet';

import type { CharacterSheetVM } from '../types';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

/**
 * #1216 (Hark T3-008, T3-009): at 1280 px the in-session sheet header read
 * "Stone Giant · Barbarian (Path of the B…" and the rail's Current Campaign title read
 * "THE NOON TITHE: SIEG". Both lines now wrap instead of truncating: the full string is in
 * the DOM as one text node, on an element that does not clip it.
 */
const CLIPPING_CLASSES = ['truncate', 'text-ellipsis', 'whitespace-nowrap', 'line-clamp-1'];

function expectWrapsInFull(text: string): void {
  const element = screen.getByText(text);
  expect(element.textContent).toBe(text);
  for (const clipping of CLIPPING_CLASSES) {
    expect(element.className.split(/\s+/)).not.toContain(clipping);
  }
  expect(element.className.split(/\s+/)).toContain('break-words');
}

const sheet: CharacterSheetVM = {
  name: 'Idris Mawr',
  subtitle: 'Stone Giant · Barbarian (Path of the Berserker)',
  level: 3,
  xpCurrent: 900,
  xpMax: 2700,
  hpCurrent: 30,
  hpMax: 30,
  ac: 14,
  initiative: '+1',
  speed: 30,
  abilityScores: [],
  savingThrows: [],
  skills: [],
  attacks: [],
  conditions: [],
  equipment: [],
  inventory: [],
  spells: { cantrips: [], known: [], prepared: [] },
  spellcasting: null,
};

describe('header lines wrap instead of cutting (#1216)', () => {
  it('the sheet header shows the full race, class and subclass line', () => {
    render(<RightSheet c={sheet} />);

    expectWrapsInFull('Stone Giant · Barbarian (Path of the Berserker)');
    expectWrapsInFull('Idris Mawr');
  });

  it('the Current Campaign card shows the full campaign title', () => {
    render(
      <LeftRail
        campaign={{ ...MOCK_VIEW_MODEL.campaign, name: 'The Noon Tithe: Siege of the Salt Road' }}
        party={[]}
        partyMax={1}
        combat={{ active: false, round: 1, combatants: [] }}
      />,
    );

    expectWrapsInFull('The Noon Tithe: Siege of the Salt Road');
  });
});
