/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CharacterFinalization from '../../CharacterFinalization';

import { characterReducer, initialState } from '@/contexts/character/character-reducer';

const harness = vi.hoisted(() => ({
  current: null as { state: any; dispatch: React.Dispatch<any> } | null,
  toast: vi.fn(),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => harness.current,
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock('@/infrastructure/api', async (importOriginal) => {
  const original = (await importOriginal()) as {
    llmApiClient: Record<string, unknown>;
    [key: string]: unknown;
  };
  return {
    ...original,
    llmApiClient: { ...original.llmApiClient, getImageQuotaStatus: async () => null },
  };
});

function StateHarness(): React.JSX.Element {
  const [state, dispatch] = React.useReducer(characterReducer, initialState);
  harness.current = { state, dispatch: dispatch as React.Dispatch<any> };
  return <CharacterFinalization />;
}

function renderSummary(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/app/characters/new']}>
      <StateHarness />
    </MemoryRouter>,
  );
}

describe('#213 physical traits on the summary step, from reducer state', () => {
  beforeEach(() => {
    harness.current = null;
    harness.toast.mockClear();
  });

  it('shows height, weight, age, gender, eye, skin and hair set on step 3', async () => {
    renderSummary();
    const { dispatch } = harness.current!;
    // The physical step's own actions, through the real reducer — no hand-built fixture.
    act(() => {
      dispatch({ type: 'SET_GENDER', payload: 'female' });
      dispatch({ type: 'SET_AGE', payload: 27 });
      dispatch({ type: 'SET_HEIGHT', payload: 58 });
      dispatch({ type: 'SET_WEIGHT', payload: 114 });
      dispatch({ type: 'SET_EYES', payload: 'green' });
      dispatch({ type: 'SET_SKIN', payload: 'tan' });
      dispatch({ type: 'SET_HAIR', payload: 'black' });
    });

    const section = await screen.findByTestId('summary-physical');
    expect(section).toBeTruthy();
    expect(screen.getByText('4\'10"')).toBeTruthy();
    expect(screen.getByText('114 lbs')).toBeTruthy();
    expect(screen.getByText('27 years')).toBeTruthy();
    expect(screen.getByText('Female')).toBeTruthy();
    expect(screen.getByText('green')).toBeTruthy();
    expect(screen.getByText('tan')).toBeTruthy();
    expect(screen.getByText('black')).toBeTruthy();
  });

  it('shows nothing when step 3 was never filled in', async () => {
    renderSummary();
    expect(screen.queryByTestId('summary-physical')).not.toBeInTheDocument();
  });
});
