import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CampaignCompleteEndState } from '../CompletionScreen';
import { FallenEndState } from '../DeathScreen';

const auth = vi.hoisted(() => ({
  userPlan: 'free' as string | null,
  userPlanLoading: false,
  userPlanError: false,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => auth,
}));

vi.mock('@/features/character/components/list/campaign-selection-modal', () => ({
  default: ({ isOpen, characterId }: { isOpen: boolean; characterId: string }) =>
    isOpen ? <div data-testid="campaign-picker">{characterId}</div> : null,
}));

const GATE = 'Your hero and their story are kept. Legend lets you play them again.';

function renderFallen(props: {
  premade?: boolean;
  premadeKept?: boolean;
  characterId?: string | null;
}): void {
  render(
    <MemoryRouter>
      <FallenEndState
        characterName="Mira"
        campaignName="Ash Keep"
        chooseHeroHref="/app/characters/create?campaign=camp-1"
        characterId={props.characterId ?? 'char-mira'}
        premade={props.premade}
        premadeKept={props.premadeKept}
      />
    </MemoryRouter>,
  );
}

describe('Take into a new adventure (#1239)', () => {
  it('opens the campaign picker for a Legend hero that is not a premade', () => {
    auth.userPlan = 'pro';
    auth.userPlanLoading = false;
    auth.userPlanError = false;
    renderFallen({});

    fireEvent.click(screen.getByRole('button', { name: 'Take Mira into a new adventure' }));

    expect(screen.getByTestId('campaign-picker')).toHaveTextContent('char-mira');
    expect(screen.queryByText(GATE)).not.toBeInTheDocument();
  });

  it('shows the Legend gate for a Free hero and does not open the picker', () => {
    auth.userPlan = 'free';
    renderFallen({});

    expect(screen.queryByText(GATE)).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-picker')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Take Mira into a new adventure' }));

    expect(screen.getByRole('status')).toHaveTextContent(GATE);
    expect(screen.queryByTestId('campaign-picker')).not.toBeInTheDocument();
  });

  it('hides the offer for a premade the player did not keep', () => {
    auth.userPlan = 'pro';
    renderFallen({ premade: true, premadeKept: false });

    expect(
      screen.queryByRole('button', { name: 'Take Mira into a new adventure' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-picker')).not.toBeInTheDocument();
  });

  it('offers the same button for a premade the player chose to keep', () => {
    auth.userPlan = 'free';
    renderFallen({ premade: true, premadeKept: true });

    expect(
      screen.getByRole('button', { name: 'Take Mira into a new adventure' }),
    ).toBeInTheDocument();
  });

  it('offers the button on the completion end state', () => {
    auth.userPlan = 'pro';
    render(
      <MemoryRouter>
        <CampaignCompleteEndState
          characterName="Mira"
          chooseHeroHref="/explore"
          characterId="char-mira"
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Take Mira into a new adventure' }));
    expect(screen.getByTestId('campaign-picker')).toHaveTextContent('char-mira');
  });
});
