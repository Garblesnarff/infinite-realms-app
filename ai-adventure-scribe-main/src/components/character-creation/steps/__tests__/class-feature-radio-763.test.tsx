/**
 * #763 remainder: the radio click in ClassFeatureChoiceCard works through the
 * real ClassFeatureSelection step. Clicking the option's label (not only the
 * radio dot) selects it and the chosen string is what the step /confirm class features/is.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ClassFeatureSelection from '../ClassFeatureSelection';

import { classes } from '@/data/classes';

const dispatch = vi.fn();
let currentClass: unknown;

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: { name: 'W', class: currentClass, level: 1 } }, dispatch }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeEach(() => {
  dispatch.mockClear();
  currentClass = classes.find((c) => c.id === 'warlock');
});

describe('#763 class feature radio in the wizard step', () => {
  it('selects an option when its label is clicked and /confirm class features/is that choice', () => {
    render(<ClassFeatureSelection />);

    // Click the option's text, the label a player actually clicks.
    fireEvent.click(screen.getByText('The Fiend'));

    const radio = document.getElementById('otherworldly-patron-1');
    expect(radio?.getAttribute('data-state')).toBe('checked');

    fireEvent.click(screen.getByRole('button', { name: /confirm class features/i }));

    const update = dispatch.mock.calls
      .map((c: unknown[]) => c[0] as { type?: string; payload?: Record<string, unknown> })
      .find((a) => a?.type === 'UPDATE_CHARACTER');
    expect(JSON.stringify(update?.payload)).toContain(
      'The Fiend: Your patron is a fiend from the lower planes',
    );
  });
});
