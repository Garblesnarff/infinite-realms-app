import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { StorySoFarLink } from '../StorySoFarLink';

const viewerSpy = vi.fn();
vi.mock('../chronicle/ChronicleDialog', () => ({
  default: (props: {
    sessionId: string | null;
    open: boolean;
    endSession?: { campaignId: string | null; starterCampaignId: string | null };
    isFallen?: boolean;
  }) => {
    viewerSpy(props);
    return props.open ? <div role="dialog">Chronicle for {props.sessionId}</div> : null;
  },
}));

describe('StorySoFarLink', () => {
  it('does not load the chronicle until the player opens it', () => {
    const endSession = { campaignId: 'campaign-1', starterCampaignId: null };
    render(<StorySoFarLink sessionId="game-1" endSession={endSession} />);
    expect(viewerSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Read the chronicle/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Chronicle for game-1');
    expect(viewerSpy).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, endSession }));
  });

  it('renders the board link card with the Story so far heading', () => {
    render(<StorySoFarLink sessionId="game-1" />);
    expect(screen.getByRole('heading', { name: 'Story so far' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Read the chronicle/ });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button.className).toContain('min-h-11');
    expect(within(button).getByText('Story so far')).toBeInTheDocument();
  });

  it('passes isFallen through to ChronicleDialog when opened', () => {
    const endSession = { campaignId: 'campaign-1', starterCampaignId: null };
    render(<StorySoFarLink sessionId="game-1" endSession={endSession} isFallen />);
    fireEvent.click(screen.getByRole('button', { name: /Read the chronicle/ }));
    expect(viewerSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, isFallen: true }),
    );
  });

  it('does not pass isFallen: true on the default living-hero path', () => {
    const endSession = { campaignId: 'campaign-1', starterCampaignId: null };
    render(<StorySoFarLink sessionId="game-1" endSession={endSession} />);
    fireEvent.click(screen.getByRole('button', { name: /Read the chronicle/ }));
    const last = viewerSpy.mock.calls[viewerSpy.mock.calls.length - 1][0];
    expect(last.isFallen).not.toBe(true);
  });
});
