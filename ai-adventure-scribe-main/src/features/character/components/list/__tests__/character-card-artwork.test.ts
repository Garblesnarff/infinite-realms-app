import { describe, expect, it } from 'vitest';

import {
  CHARACTER_ARTWORK_PLACEHOLDER,
  resolveCharacterCardArtwork,
} from '../character-card-artwork';

describe('character roster artwork fallback', () => {
  it('does not use the PNG that claims to be loading', () => {
    const missing = resolveCharacterCardArtwork({
      backgroundImage: null,
      hotLoadedImage: '/character-background-placeholder.png',
      hasImage: false,
      imageLoading: false,
    });
    expect(missing.url).toBe(CHARACTER_ARTWORK_PLACEHOLDER);
    expect(missing.url).not.toContain('character-background-placeholder.png');
    expect(missing.artworkUnavailable).toBe(true);
    expect(missing.showGenerating).toBe(false);
  });

  it('keeps a real generating overlay only while polling is actually running', () => {
    const generating = resolveCharacterCardArtwork({
      backgroundImage: null,
      hotLoadedImage: CHARACTER_ARTWORK_PLACEHOLDER,
      hasImage: false,
      imageLoading: true,
    });
    expect(generating.showGenerating).toBe(true);
    expect(generating.artworkUnavailable).toBe(false);
    expect(generating.url).toBe(CHARACTER_ARTWORK_PLACEHOLDER);
  });

  it('prefers a real background_image when the character has one', () => {
    const painted = resolveCharacterCardArtwork({
      backgroundImage: '/images/characters/faithful-card.png',
      hotLoadedImage: CHARACTER_ARTWORK_PLACEHOLDER,
      hasImage: false,
      imageLoading: false,
    });
    expect(painted.url).toBe('/images/characters/faithful-card.png');
    expect(painted.artworkUnavailable).toBe(false);
  });
});
