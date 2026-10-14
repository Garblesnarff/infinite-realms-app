import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import BasicInfo from '../BasicInfo';

import { CharacterProvider } from '@/contexts/CharacterContext';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('BasicInfo wizard step (#213)', () => {
  it('names the Name field when the input exceeds its limit', () => {
    render(
      <CharacterProvider>
        <BasicInfo />
      </CharacterProvider>,
    );

    const input = screen.getByLabelText(/Name/);
    fireEvent.change(input, { target: { value: 'A'.repeat(51) } });
    fireEvent.blur(input);

    expect(screen.getByRole('alert')).toHaveTextContent('Name must be 50 characters or less');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
