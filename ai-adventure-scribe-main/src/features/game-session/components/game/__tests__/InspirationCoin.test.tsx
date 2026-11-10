import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InspirationCoin } from '../InspirationCoin';

import { InspirationArmedProvider } from '@/features/game-session/contexts/inspiration-armed-context';

const value = vi.hoisted(() => ({ inspiration: undefined as boolean | undefined }));
vi.mock('@/contexts/CharacterContext', () => ({
  useOptionalCharacter: () => ({ state: { character: { inspiration: value.inspiration } } }),
}));

const renderCoin = () =>
  render(
    <InspirationArmedProvider>
      <InspirationCoin />
    </InspirationArmedProvider>,
  );

describe('Inspiration coin (#1414)', () => {
  it('hides when the flag is unknown', () => {
    value.inspiration = undefined;
    renderCoin();
    expect(screen.queryByRole('button', { name: /inspiration/i })).not.toBeInTheDocument();
  });

  it('shows gold when the character has inspiration, grey when spent', () => {
    value.inspiration = true;
    const { unmount } = renderCoin();
    const gold = screen.getByRole('button', { name: /spend inspiration/i });
    expect(gold).toBeEnabled();
    expect(gold.className).toContain('var(--ir-brass-1)');
    unmount();

    value.inspiration = false;
    renderCoin();
    const grey = screen.getByRole('button', { name: /no inspiration/i });
    expect(grey).toBeDisabled();
    expect(grey.className).toContain('var(--ir-wax-slate)');
  });

  it('meets the 44 px touch target', () => {
    value.inspiration = true;
    renderCoin();
    const coin = screen.getByRole('button', { name: /spend inspiration/i });
    expect(coin.className).toContain('min-h-11');
    expect(coin.className).toContain('min-w-11');
  });

  it('tapping a gold coin arms advantage; tapping again disarms', async () => {
    value.inspiration = true;
    renderCoin();
    const user = userEvent.setup();
    const coin = screen.getByRole('button', { name: /spend inspiration/i });
    expect(coin).toHaveAttribute('aria-pressed', 'false');

    await user.click(coin);
    expect(coin).toHaveAttribute('aria-pressed', 'true');
    expect(coin).toHaveTextContent('armed');

    await user.click(coin);
    expect(coin).toHaveAttribute('aria-pressed', 'false');
    expect(coin).not.toHaveTextContent('armed');
  });

  it('a grey coin does nothing on tap', async () => {
    value.inspiration = false;
    renderCoin();
    const user = userEvent.setup();
    const coin = screen.getByRole('button', { name: /no inspiration/i });
    await user.click(coin);
    expect(coin).toHaveAttribute('aria-pressed', 'false');
  });
});
