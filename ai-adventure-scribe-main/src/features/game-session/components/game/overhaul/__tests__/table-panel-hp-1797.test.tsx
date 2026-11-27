/**
 * #1797: the table panel's HP for the hero follows the combat state, and shows the same number as
 * the header. The view model is real; the contexts and the combat-status poll are the inputs.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CharacterHeaderVitals } from '../../CharacterHeaderVitals';
import { LeftRailLive } from '../LeftRailLive';

const state = vi.hoisted(() => ({
  combatHP: null as null | {
    current_hp: number;
    max_hp: number;
    temp_hp: number;
    is_conscious: boolean;
  },
  inCombat: true,
}));

const character = {
  id: 'hero-1',
  name: 'Mira',
  level: 3,
  race: { name: 'Human', speed: 30 },
  class: { name: 'Wizard', hitDie: 6 },
  character_stats: { current_hit_points: 19, max_hit_points: 28, armor_class: 12 },
};

const encounter = {
  id: 'enc-1',
  phase: 'active',
  currentRound: 2,
  currentTurnParticipantId: 'pc-1',
  participants: [
    {
      id: 'pc-1',
      participantType: 'player',
      characterId: 'hero-1',
      name: 'Mira',
      currentHitPoints: 14,
      maxHitPoints: 28,
      temporaryHitPoints: 0,
      isActive: true,
      deathSaves: { successes: 0, failures: 0 },
    },
  ],
};

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQuery: () => ({ data: undefined, refetch: vi.fn() }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: { name: 'Test Campaign' } } }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character } }),
  useOptionalCharacter: () => ({ state: { character } }),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { isInCombat: state.inCombat, activeEncounter: state.inCombat ? encounter : null },
  }),
  useOptionalCombat: () => ({
    state: { isInCombat: state.inCombat, activeEncounter: state.inCombat ? encounter : null },
  }),
}));
vi.mock('@/contexts/MessageContext', () => ({ useMessageContext: () => ({ messages: [] }) }));
vi.mock('../../use-combat-hp', () => ({ useCombatHP: () => state.combatHP }));

const hpStatus = (current: number) => ({
  current_hp: current,
  max_hp: 28,
  temp_hp: 0,
  is_conscious: current > 0,
});

/** The hero's HP as the party list prints it, e.g. "14 / 28" (formatCharacterSheetHitPoints). */
function panelHitPoints(): string {
  return screen.getByText(/^\d+\s*\/\s*28$/).textContent ?? '';
}

beforeEach(() => {
  state.inCombat = true;
  state.combatHP = null;
});
afterEach(() => {
  state.combatHP = null;
});

describe('table panel HP follows the combat state (#1797)', () => {
  it('shows the combat status HP while in combat', () => {
    state.combatHP = hpStatus(14);
    render(<LeftRailLive sessionId="s" onOpenSheet={() => {}} />);
    expect(panelHitPoints()).toContain('14');
    expect(panelHitPoints()).not.toContain('19');
  });

  it('follows each change of the combat status, as the fight goes on', () => {
    state.combatHP = hpStatus(19);
    const { rerender } = render(<LeftRailLive sessionId="s" onOpenSheet={() => {}} />);
    expect(panelHitPoints()).toContain('19');
    for (const hp of [14, 9, 0]) {
      state.combatHP = hpStatus(hp);
      rerender(<LeftRailLive sessionId="s" onOpenSheet={() => {}} />);
      expect(panelHitPoints()).toContain(String(hp));
    }
  });

  it('shows the sheet HP once the fight is over', () => {
    state.combatHP = hpStatus(9);
    const { rerender } = render(<LeftRailLive sessionId="s" onOpenSheet={() => {}} />);
    state.inCombat = false;
    state.combatHP = null;
    rerender(<LeftRailLive sessionId="s" onOpenSheet={() => {}} />);
    expect(panelHitPoints()).toContain('19');
  });

  it('shows the same number as the header vitals for the same status', () => {
    state.combatHP = hpStatus(14);
    const { unmount } = render(<LeftRailLive sessionId="s" onOpenSheet={() => {}} />);
    expect(panelHitPoints()).toContain('14');
    unmount();
    const { container } = render(
      <CharacterHeaderVitals
        combatHP={hpStatus(14)}
        currentHp={19}
        maxHp={28}
        armorClass={12}
        proficiency={2}
      />,
    );
    expect(container.querySelector('[aria-label="Hit Points: 14 out of 28"]')).not.toBeNull();
  });
});
