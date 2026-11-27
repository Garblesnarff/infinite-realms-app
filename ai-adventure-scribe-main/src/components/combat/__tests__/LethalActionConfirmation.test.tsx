import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LethalActionConfirmation } from '../LethalActionConfirmation';

describe('LethalActionConfirmation (#468)', () => {
  it('asks "Are you sure?" and Yes confirms while No cancels', () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    render(
      <LethalActionConfirmation
        confirmation={{
          spec: { playerMessage: 'I step off the edge to my death' },
          confirm,
          cancel,
        }}
      />,
    );

    expect(screen.getByText('Are you sure?')).toBeTruthy();
    expect(screen.getByTestId('lethal-action-confirmation')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there is no pending confirmation', () => {
    const { container } = render(<LethalActionConfirmation confirmation={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
