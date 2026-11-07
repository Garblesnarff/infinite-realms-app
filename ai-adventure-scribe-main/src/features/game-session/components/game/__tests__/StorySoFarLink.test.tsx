import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { StorySoFarLink } from '../StorySoFarLink';

const viewerSpy = vi.fn();
vi.mock('@/components/chronicles/ChronicleViewer', () => ({
  default: (props: { sessionId: string | null; open: boolean }) => {
    viewerSpy(props);
    return props.open ? <div role="dialog">Chronicle for {props.sessionId}</div> : null;
  },
}));

describe('StorySoFarLink', () => {
  it('does not load the chronicle until the player opens it', () => {
    render(<StorySoFarLink sessionId="game-1" />);
    expect(viewerSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Read the chronicle/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Chronicle for game-1');
    expect(viewerSpy).toHaveBeenLastCalledWith(expect.objectContaining({ open: true }));
  });

  it('renders the board link card with the Story so far heading', () => {
    render(<StorySoFarLink sessionId="game-1" />);
    expect(screen.getByRole('heading', { name: 'Story so far' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Read the chronicle/ });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button.className).toContain('min-h-11');
    expect(within(button).getByText('Story so far')).toBeInTheDocument();
  });
});
