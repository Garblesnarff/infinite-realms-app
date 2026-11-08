import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LeftRailLive } from '../LeftRailLive';

const image = vi.hoisted(() => ({ url: 'primary-image' as string | undefined }));
vi.mock('@/contexts/CharacterContext', () => ({
  useOptionalCharacter: () => ({ state: { character: { image_url: image.url } } }),
}));
vi.mock('@/contexts/MessageContext', () => ({ useMessageContext: () => ({ messages: [] }) }));
vi.mock('../useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    character: { avatarUrl: 'fallback-avatar' },
    campaign: {},
    party: [],
    partyMax: 1,
    combat: {},
  }),
}));
vi.mock('../LeftRail', () => ({
  LeftRail: () => null,
  TableCharacterCard: ({
    preferredPortrait,
    character,
  }: {
    preferredPortrait?: string;
    character: { avatarUrl?: string };
  }) => (
    <span data-testid="character-portrait-source">
      {preferredPortrait ?? 'none'} | {character.avatarUrl}
    </span>
  ),
}));

describe('Table character portrait source', () => {
  it('prefers the character image, falling back to the sheet avatar', () => {
    const view = render(<LeftRailLive sessionId="session" onOpenSheet={() => {}} />);
    expect(screen.getByTestId('character-portrait-source')).toHaveTextContent(
      'primary-image | fallback-avatar',
    );
    image.url = undefined;
    view.rerender(<LeftRailLive sessionId="session" onOpenSheet={() => {}} />);
    expect(screen.getByTestId('character-portrait-source')).toHaveTextContent(
      'none | fallback-avatar',
    );
  });
});
