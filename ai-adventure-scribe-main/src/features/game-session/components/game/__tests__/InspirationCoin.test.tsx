import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspirationCoin } from '../InspirationCoin';

const value = vi.hoisted(() => ({ inspiration: undefined as boolean | undefined }));
vi.mock('@/contexts/CharacterContext', () => ({
  useOptionalCharacter: () => ({ state: { character: { inspiration: value.inspiration } } }),
}));

describe('Inspiration coin', () => {
  it.each([true, false, undefined] as const)(
    'hides the nonfunctional coin for state %s',
    (inspiration) => {
      value.inspiration = inspiration;
      render(<InspirationCoin />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    },
  );
});
