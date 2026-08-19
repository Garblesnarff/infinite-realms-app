/** Honest storefront fallback. Do not use character-background-placeholder.png — that PNG
 *  has "LOADING CHARACTER..." lettered into the artwork and never finishes (#1861). */
export const CHARACTER_ARTWORK_PLACEHOLDER = '/card-placeholder.svg';

const LYING_LOADING_PLACEHOLDER = '/character-background-placeholder.png';

export function resolveCharacterCardArtwork(input: {
  backgroundImage?: string | null;
  hotLoadedImage: string;
  hasImage: boolean;
  imageLoading: boolean;
}): { url: string; showGenerating: boolean; artworkUnavailable: boolean } {
  const realHotLoad =
    input.hasImage &&
    Boolean(input.hotLoadedImage) &&
    input.hotLoadedImage !== CHARACTER_ARTWORK_PLACEHOLDER &&
    input.hotLoadedImage !== LYING_LOADING_PLACEHOLDER;

  if (realHotLoad) {
    return { url: input.hotLoadedImage, showGenerating: false, artworkUnavailable: false };
  }
  if (input.backgroundImage) {
    return { url: input.backgroundImage, showGenerating: false, artworkUnavailable: false };
  }
  if (input.imageLoading) {
    return {
      url: CHARACTER_ARTWORK_PLACEHOLDER,
      showGenerating: true,
      artworkUnavailable: false,
    };
  }
  return {
    url: CHARACTER_ARTWORK_PLACEHOLDER,
    showGenerating: false,
    artworkUnavailable: true,
  };
}
