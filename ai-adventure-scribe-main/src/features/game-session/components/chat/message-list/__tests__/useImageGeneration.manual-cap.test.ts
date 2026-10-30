import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getImageGenerationCap,
  MAX_IMAGE_GENERATIONS_PER_SESSION,
} from '../image-generation-session-cap';
import { useImageGeneration } from '../useImageGeneration';

import type { ChatMessage } from '@/types/game';

const generateSceneImage = vi.fn(async () => ({
  url: 'https://example.test/scene.png',
  prompt: 'p',
  model: 'm',
}));

vi.mock('@/services/scene-image-generator', () => ({
  generateSceneImage: (...args: unknown[]) => generateSceneImage(...(args as [])),
}));
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: { appendMessageImage: vi.fn(async () => undefined) },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SESSION = 'session-cap-test';
const message = {
  id: 'dm-1',
  sender: 'dm',
  text: 'The bell rings over the square.',
} as unknown as ChatMessage;

const setup = () =>
  renderHook(() =>
    useImageGeneration({
      sessionId: SESSION,
      routeCampaignId: undefined,
      character: null,
      campaign: null,
      messages: [],
    }),
  );

describe('manual scene illustration obeys the per-session cap (#1236 D)', () => {
  beforeEach(() => {
    localStorage.clear();
    generateSceneImage.mockClear();
  });

  it('refuses a manual request at the cap, with a message, and calls no image service', async () => {
    localStorage.setItem(`dm-img-cap:${SESSION}`, String(MAX_IMAGE_GENERATIONS_PER_SESSION));
    const { result } = setup();

    await act(async () => {
      await result.current.handleGenerateScene(message);
    });

    expect(generateSceneImage).not.toHaveBeenCalled();
    expect(result.current.genErrorByMessage['dm-1']).toBe(
      'This session has used all of its scene images.',
    );
  });

  it('generates when under the cap and counts the image', async () => {
    const { result } = setup();
    expect(getImageGenerationCap(SESSION)).toBe(0);

    await act(async () => {
      await result.current.handleGenerateScene(message);
    });

    expect(generateSceneImage).toHaveBeenCalledTimes(1);
    expect(getImageGenerationCap(SESSION)).toBe(1);
  });
});
