import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LethalActionConfirmation } from '../LethalActionConfirmation';

const pending = (confirm = vi.fn(), cancel = vi.fn()) => ({
  confirmation: {
    spec: { playerMessage: 'I step off the edge to my death' },
    confirm,
    cancel,
  },
  confirm,
  cancel,
});

describe('LethalActionConfirmation (#468)', () => {
  it('is an alertdialog that warns this can kill the hero, with focus on No', () => {
    const { confirm, cancel, confirmation } = pending();
    render(<LethalActionConfirmation confirmation={confirmation} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'lethal-action-title');
    expect(screen.getByText('Are you sure?')).toHaveAttribute('id', 'lethal-action-title');
    expect(screen.getByText('This can kill the hero.')).toHaveAttribute('id', 'lethal-action-desc');
    expect(dialog).toHaveAttribute('aria-describedby', 'lethal-action-desc');
    expect(screen.getByRole('button', { name: 'No' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('treats Escape as No', () => {
    const { confirm, cancel, confirmation } = pending();
    render(<LethalActionConfirmation confirmation={confirmation} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('renders nothing when there is no pending confirmation', () => {
    const { container } = render(<LethalActionConfirmation confirmation={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
