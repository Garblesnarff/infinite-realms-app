import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { SessionRestPrompt } from './SessionRestPrompt';
import { useSessionRestGate } from './use-session-rest-gate';

import type { Character } from '@/types/character';

function Continuation(): JSX.Element | null {
  const gate = useSessionRestGate({
    sessionId: 'session-two',
    session: { session_number: 2, turn_count: 0 },
    character: {
      id: 'hero',
      name: 'Bram',
      character_stats: { current_hit_points: 4, max_hit_points: 10 },
    } as unknown as Character,
    dispatch: vi.fn(),
  });
  return gate.showPrompt ? (
    <SessionRestPrompt
      characterName="Bram"
      currentHp={gate.currentHp!}
      maxHp={gate.maxHp!}
      resting={gate.resting}
      restError={gate.restError}
      onRestFirst={gate.restFirst}
      onContinue={gate.continueAsIs}
    />
  ) : null;
}

it('offers rest for an injured hero at the start of session two', () => {
  window.sessionStorage.clear();
  render(<Continuation />);
  expect(screen.getByRole('heading', { name: 'Rest first?' })).toBeInTheDocument();
  expect(screen.getByText('Bram starts at 4/10 HP.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue as you are' }));
  expect(screen.queryByRole('heading', { name: 'Rest first?' })).not.toBeInTheDocument();
});
