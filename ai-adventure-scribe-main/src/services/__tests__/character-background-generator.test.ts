/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { characterBackgroundGenerator } from '../character-background-generator';
import { openRouterService } from '../openrouter-service';

import logger from '@/lib/logger';

// Mock dependencies
vi.mock('../openrouter-service', () => ({
  openRouterService: {
    generateImage: vi.fn(),
    uploadImage: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('CharacterBackgroundGenerator', () => {
  const mockCharacter: any = {
    name: 'Thalric',
    race: { name: 'Elf' },
    class: { name: 'Wizard' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe('generateCharacterBackground', () => {
    it('should generate a background successfully without reference image', async () => {
      const mockBase64 = 'base64-string';
      const mockUrl = 'https://storage.com/image.png';

      vi.mocked(openRouterService.generateImage).mockResolvedValue(mockBase64);
      vi.mocked(openRouterService.uploadImage).mockResolvedValue(mockUrl);

      const result = await characterBackgroundGenerator.generateCharacterBackground(mockCharacter);

      expect(result).toBe(mockUrl);
      expect(openRouterService.generateImage).toHaveBeenCalledWith(expect.objectContaining({
        prompt: expect.stringContaining('Thalric'),
        model: 'google/gemini-2.5-flash-image',
      }));
      expect(openRouterService.uploadImage).toHaveBeenCalledWith(mockBase64);
    });

    it('should generate a background successfully with reference image', async () => {
      const mockBase64 = 'base64-string';
      const mockUrl = 'https://storage.com/image.png';
      const referenceImageUrl = 'https://example.com/sheet.png';
      const referenceBase64 = 'reference-base64';

      // Mock fetch and FileReader for convertImageUrlToBase64
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
      }));

      // Mock FileReader
      class MockFileReader {
        onload: any;
        result: any;
        readAsDataURL() {
          this.result = 'data:image/png;base64,' + referenceBase64;
          this.onload();
        }
      }
      vi.stubGlobal('FileReader', MockFileReader);

      vi.mocked(openRouterService.generateImage).mockResolvedValue(mockBase64);
      vi.mocked(openRouterService.uploadImage).mockResolvedValue(mockUrl);

      const result = await characterBackgroundGenerator.generateCharacterBackground(mockCharacter, {
        referenceImageUrl,
      });

      expect(result).toBe(mockUrl);
      expect(openRouterService.generateImage).toHaveBeenCalledWith(expect.objectContaining({
        referenceImage: referenceBase64,
      }));
    });

    it('should use fallback image when generation fails after retries', async () => {
      vi.mocked(openRouterService.generateImage).mockRejectedValue(new Error('Generation failed'));

      const promise = characterBackgroundGenerator.generateCharacterBackground(mockCharacter, {
        retryAttempts: 2,
      });

      // Advance timers for retries
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result).toBe('/card-background.jpeg');
      expect(openRouterService.generateImage).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith('Failed to generate character background:', expect.any(Error));
    });

    it('should throw error when fallback is disabled', async () => {
      vi.mocked(openRouterService.generateImage).mockRejectedValue(new Error('Generation failed'));

      const promise = characterBackgroundGenerator.generateCharacterBackground(mockCharacter, {
        retryAttempts: 1,
        fallbackToDefault: false,
      });

      await expect(promise).rejects.toThrow('Generation failed');
    });

    it('should retry with exponential backoff', async () => {
      vi.mocked(openRouterService.generateImage)
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValueOnce('success-base64');

      vi.mocked(openRouterService.uploadImage).mockResolvedValue('success-url');

      const promise = characterBackgroundGenerator.generateCharacterBackground(mockCharacter, {
        retryAttempts: 2,
      });

      // First attempt fails, waits 1000ms (2^0 * 1000)
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).toBe('success-url');
      expect(openRouterService.generateImage).toHaveBeenCalledTimes(2);
    });

    it('should handle fetch failure during image conversion', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }));

      vi.mocked(openRouterService.generateImage).mockResolvedValue('base64');
      vi.mocked(openRouterService.uploadImage).mockResolvedValue('url');

      await characterBackgroundGenerator.generateCharacterBackground(mockCharacter, {
        referenceImageUrl: 'bad-url',
      });

      // Should log warning and proceed without reference image
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to convert reference image to base64, proceeding without vision input:',
        expect.any(Error)
      );
      expect(openRouterService.generateImage).toHaveBeenCalledWith(expect.not.objectContaining({
        referenceImage: expect.any(String),
      }));
    });
  });

  describe('createImagePrompt', () => {
    // We access private methods for testing prompt logic
    const generator = characterBackgroundGenerator as any;

    it('should include character name, race and class in the prompt', () => {
      const prompt = generator.createImagePrompt(mockCharacter);
      expect(prompt).toContain('Thalric');
      expect(prompt).toContain('Elf');
      expect(prompt).toContain('Wizard');
    });

    it('should include elven theme for elves', () => {
      const prompt = generator.createImagePrompt({ ...mockCharacter, race: { name: 'Elf' }, class: { name: 'Fighter' } }, true);
      expect(prompt).toContain('Theme: Mystical forest or ancient elven architecture');
    });

    it('should include dwarven theme for dwarves', () => {
      const prompt = generator.createImagePrompt({ ...mockCharacter, race: { name: 'Dwarf' }, class: { name: 'Fighter' } }, true);
      expect(prompt).toContain('Theme: Stone mountain hall or forge');
    });

    it('should include wizardly theme for wizards', () => {
      const prompt = generator.createImagePrompt({ ...mockCharacter, race: { name: 'Human' }, class: { name: 'Wizard' } }, true);
      expect(prompt).toContain('Theme: Arcane library or magical ritual circle');
    });

    it('should include martial theme for barbarians', () => {
      const prompt = generator.createImagePrompt({ ...mockCharacter, race: { name: 'Human' }, class: { name: 'Barbarian' } }, true);
      expect(prompt).toContain('Theme: Rugged wilderness camp or ancient battleground ruins');
    });

    it('should use text-only prompt when no reference image is used', () => {
      const prompt = generator.createImagePrompt(mockCharacter, false);
      expect(prompt).toContain('Create a complete fantasy character card');
      expect(prompt).not.toContain('Using the provided character sheet image as reference');
    });

    it('should include sorcerer theme for sorcerers', () => {
      const prompt = generator.createImagePrompt({ ...mockCharacter, race: { name: 'Human' }, class: { name: 'Sorcerer' } }, true);
      expect(prompt).toContain('Theme: Arcane library or magical ritual circle');
    });

    it('should include fighter theme for fighters', () => {
      const prompt = generator.createImagePrompt({ ...mockCharacter, race: { name: 'Human' }, class: { name: 'Fighter' } }, true);
      expect(prompt).toContain('Theme: Rugged wilderness camp or ancient battleground ruins');
    });

    it('should include default theme for other classes', () => {
      const prompt = generator.createImagePrompt({ ...mockCharacter, race: { name: 'Human' }, class: { name: 'Rogue' } }, true);
      expect(prompt).toContain('Theme: Classic fantasy landscape with mystical elements');
    });

    it('should handle missing name, race, or class', () => {
      const prompt = generator.createImagePrompt({}, true);
      expect(prompt).toContain('Unknown Adventurer');
      expect(prompt).toContain('mysterious');
      expect(prompt).toContain('adventurer');
    });
  });

  describe('convertImageUrlToBase64', () => {
    const generator = characterBackgroundGenerator as any;

    it('should reject when FileReader errors', async () => {
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
      }));

      class ErrorFileReader {
        onerror: any;
        readAsDataURL() {
          this.onerror();
        }
      }
      vi.stubGlobal('FileReader', ErrorFileReader);

      await expect(generator.convertImageUrlToBase64('url')).rejects.toThrow('Failed to convert image to base64');
    });
  });
});
