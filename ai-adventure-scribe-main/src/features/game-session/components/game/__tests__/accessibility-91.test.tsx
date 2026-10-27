import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CombatActionBar } from '../CombatActionBar';

import { DiceRollRequest } from '@/components/game/DiceRollRequest';
import { useCharacter } from '@/contexts/CharacterContext';
import { ChatInput } from '@/features/game-session/components/chat/ChatInput';

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >((props, ref) => <textarea ref={ref} {...props} />),
}));
vi.mock('@/utils/diceCommandParser', () => ({
  mightBeDiceCommand: vi.fn(() => false),
  getDiceCommandSuggestions: vi.fn(() => []),
}));
vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: vi.fn() }));
vi.mock('@/features/game-session/components', () => ({
  DiceRollEmbed: ({
    autoRoll,
    onRoll,
  }: {
    autoRoll?: boolean;
    onRoll: (result: number) => void;
  }) => {
    useEffect(() => {
      if (autoRoll) onRoll(15);
    }, [autoRoll, onRoll]);
    return <div data-testid="dice-animation" />;
  },
}));
vi.mock('@/utils/characterModifiers', () => ({
  calculateRollWithBreakdown: vi.fn(() => ({
    formula: '1d20+5',
    breakdown: ['1d20', 'STR +5'],
    totalModifier: 5,
    isProficient: true,
  })),
  calculateRollWithBreakdownActual: vi.fn(),
  SKILL_ABILITIES: {},
}));

const attackAction = {
  type: 'attack' as const,
  label: 'Attack with Longsword',
  weaponId: 'longsword',
  targetIds: ['goblin-1'],
};
const endTurnAction = { type: 'end_turn' as const, label: 'End turn' };
const combatBarProps = {
  enabled: true,
  hasSpells: false,
  nameOf: (id: string) => (id === 'goblin-1' ? 'Goblin' : id),
  attackSub: 'Longsword · +5',
  canMove: false,
  spellInfo: () => null,
  onMove: vi.fn(),
};

function tabUntil(target: HTMLElement): Promise<void> {
  return (async () => {
    const user = userEvent.setup();
    for (let i = 0; i < 20 && document.activeElement !== target; i += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(target);
  })();
}

function KeyboardCombatTurn(): React.ReactElement {
  const [step, setStep] = useState<'bar' | 'roll' | 'end'>('bar');
  const completed = step === 'end';
  if (step === 'roll') {
    return (
      <DiceRollRequest
        request={{
          type: 'attack',
          formula: '1d20+5',
          purpose: 'Longsword attack vs Goblin',
          ac: 12,
        }}
        onResult={() => setStep('end')}
      />
    );
  }
  return (
    <>
      <CombatActionBar
        {...combatBarProps}
        actions={step === 'bar' ? [attackAction] : [endTurnAction]}
        onAction={(action) => {
          if (action.type === 'attack') setStep('roll');
          if (action.type === 'end_turn') setStep('end');
        }}
      />
      {completed && <output data-testid="combat-turn-complete">Combat turn complete</output>}
    </>
  );
}

describe('game-screen keyboard paths (#91)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCharacter).mockReturnValue({
      state: {
        character: {
          name: 'Mira',
          level: 1,
          abilityScores: {
            strength: { score: 20, modifier: 5 },
            dexterity: { score: 10, modifier: 0 },
            constitution: { score: 10, modifier: 0 },
            intelligence: { score: 10, modifier: 0 },
            wisdom: { score: 10, modifier: 0 },
            charisma: { score: 10, modifier: 0 },
          },
        },
      },
    } as never);
  });

  it('completes a story turn by tabbing to the composer and pressing Enter', async () => {
    const onSendMessage = vi.fn();
    render(<ChatInput onSendMessage={onSendMessage} isDisabled={false} />);
    const textarea = screen.getByRole('textbox', {
      name: /describe what your character would like to do/i,
    });
    await tabUntil(textarea);
    const user = userEvent.setup();
    await user.type(textarea, 'Look around the ruined watchtower');
    await user.keyboard('{Enter}');
    expect(onSendMessage).toHaveBeenCalledWith('Look around the ruined watchtower');
  });

  it('completes Attack, roll, and End turn with keyboard activation', async () => {
    render(<KeyboardCombatTurn />);
    const attack = screen.getByRole('button', { name: /^Attack/ });
    await tabUntil(attack);
    const user = userEvent.setup();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /Longsword attack/i })).toBeInTheDocument(),
    );
    const roll = screen.getByRole('button', { name: /Roll 1d20\+5 for Longsword attack/i });
    await tabUntil(roll);
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^End turn/ })).toBeInTheDocument(),
    );
    const endTurn = screen.getByRole('button', { name: /^End turn/ });
    await tabUntil(endTurn);
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('combat-turn-complete')).toHaveTextContent('Combat turn complete');
  });
});
