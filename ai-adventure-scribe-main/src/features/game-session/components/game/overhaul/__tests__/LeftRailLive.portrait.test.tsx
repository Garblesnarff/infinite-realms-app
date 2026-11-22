import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LeftRailLive } from '../LeftRailLive';

const characterState = vi.hoisted(() => ({
  id: 'char-99' as string | undefined,
  url: 'primary-image' as string | undefined,
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useOptionalCharacter: () => ({
    state: { character: { id: characterState.id, image_url: characterState.url } },
  }),
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
    characterId,
    preferredPortrait,
    character,
  }: {
    characterId?: string;
    preferredPortrait?: string;
    character: { avatarUrl?: string };
  }) => (
    <span data-testid="character-portrait-source">
      {characterId ?? 'none'} | {preferredPortrait ?? 'none'} | {character.avatarUrl}
    </span>
  ),
}));

describe('Table character portrait source', () => {
  it('prefers the character image, falling back to the sheet avatar, and forwards characterId', () => {
    const view = render(<LeftRailLive sessionId="session" onOpenSheet={() => {}} />);
    expect(screen.getByTestId('character-portrait-source')).toHaveTextContent(
      'char-99 | primary-image | fallback-avatar',
    );
    characterState.url = undefined;
    view.rerender(<LeftRailLive sessionId="session" onOpenSheet={() => {}} />);
    expect(screen.getByTestId('character-portrait-source')).toHaveTextContent(
      'char-99 | none | fallback-avatar',
    );
  });
});
