import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspirationCoin } from '../InspirationCoin';

const value = vi.hoisted(() => ({ inspiration: undefined as boolean | undefined }));
vi.mock('@/contexts/CharacterContext', () => ({
  useOptionalCharacter: () => ({ state: { character: { inspiration: value.inspiration } } }),
}));

describe('Inspiration coin', () => {
  it.each([
    [true, 'available'],
    [false, 'unavailable'],
    [undefined, 'unknown'],
  ] as const)('shows %s from the character state', (inspiration, label) => {
    value.inspiration = inspiration;
    render(<InspirationCoin />);
    expect(screen.getByRole('status')).toHaveTextContent(`Inspiration ${label}`);
    expect(screen.getByRole('status')).toHaveTextContent('spending coming soon');
  });
});
