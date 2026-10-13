import { beforeEach, describe, expect, it, vi } from 'vitest';

import { characterImageGenerator } from '../character-image-generator';
import { openRouterService } from '../openrouter-service';

import type { CharacterPromptData } from '@/services/prompts/character-prompt-types';

vi.mock('../gemini-image-service', () => ({
  geminiImageService: {
    canUseFreeToday: vi.fn(),
    getRemainingFreeRequests: vi.fn(),
    generateImage: vi.fn(),
  },
}));

vi.mock('../openrouter-service', () => ({
  openRouterService: {
    generateImage: vi.fn(),
    uploadImage: vi.fn(),
  },
}));

const mockCharacterData: CharacterPromptData = {
  name: 'Thorin',
  race: 'Dwarf',
  class: 'Fighter',
  description: 'A sturdy dwarf with a braided beard',
};

describe('CharacterImageGenerator reference images handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openRouterService.generateImage).mockResolvedValue('mock-base64-result');
    vi.mocked(openRouterService.uploadImage).mockResolvedValue('https://example.com/mock-image.png');
  });

  it('forwards referenceImages array when referenceImageBase64 is provided', async () => {
    const refImage = 'data:image/png;base64,test-ref-data';

    await characterImageGenerator.generateCharacterImage(
      mockCharacterData,
      { style: 'character-sheet' },
      refImage,
    );

    expect(openRouterService.generateImage).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(openRouterService.generateImage).mock.calls[0][0];

    expect(callArg.referenceImages).toEqual([refImage]);
    expect(callArg).not.toHaveProperty('referenceImage');
  });

  it('sends no reference key when no reference image is provided', async () => {
    await characterImageGenerator.generateCharacterImage(
      mockCharacterData,
      { style: 'character-sheet' },
    );

    expect(openRouterService.generateImage).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(openRouterService.generateImage).mock.calls[0][0];

    expect(callArg).not.toHaveProperty('referenceImages');
    expect(callArg).not.toHaveProperty('referenceImage');
  });
});
