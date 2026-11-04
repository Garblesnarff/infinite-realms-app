import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getImageGenerationCap } from '../image-generation-session-cap';
import { useImageGeneration } from '../useImageGeneration';

import type { ChatMessage } from '@/types/game';

const generateSceneImage = vi.fn(async () => ({
  url: 'https://example.test/scene.png',
  prompt: 'p',
  model: 'm',
}));

const appendMessageImage = vi.fn(async () => undefined);

vi.mock('@/services/scene-image-generator', () => ({
  generateSceneImage: (...args: unknown[]) => generateSceneImage(...(args as [])),
}));
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: { appendMessageImage: (...args: unknown[]) => appendMessageImage(...(args as [])) },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SESSION = 'session-persist-test';
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

describe('generated scene art is written server-side before it shows (#1371)', () => {
  beforeEach(() => {
    localStorage.clear();
    generateSceneImage.mockClear();
    appendMessageImage.mockClear();
    appendMessageImage.mockImplementation(async () => undefined);
  });

  it('does not show a generated image when the server persist fails', async () => {
    appendMessageImage.mockRejectedValueOnce(new Error('API 404: Message not found'));
    const { result } = setup();

    await act(async () => {
      await result.current.handleGenerateScene(message);
    });

    expect(generateSceneImage).toHaveBeenCalledTimes(1);
    expect(appendMessageImage).toHaveBeenCalledTimes(1);
    expect(result.current.imageByMessage['dm-1']).toBeUndefined();
    expect(result.current.genErrorByMessage['dm-1']).toBe('Failed to save generated image');
    // A failed persist burns neither a cap charge nor a stuck spinner: the
    // user can Retry without the session reading as out of images.
    expect(getImageGenerationCap(SESSION)).toBe(0);
    expect(result.current.generatingFor.size).toBe(0);
  });

  it('shows the image only after the server persist resolves', async () => {
    let resolveAppend!: () => void;
    appendMessageImage.mockImplementation(
      () => new Promise<undefined>((resolve) => { resolveAppend = () => resolve(undefined); }),
    );
    const { result } = setup();

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.handleGenerateScene(message);
    });
    // Let generation finish and the persist call start, while it is still pending.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(generateSceneImage).toHaveBeenCalledTimes(1);
    expect(appendMessageImage).toHaveBeenCalledTimes(1);
    expect(result.current.imageByMessage['dm-1']).toBeUndefined();

    await act(async () => {
      resolveAppend();
      await pending;
    });
    expect(result.current.imageByMessage['dm-1']?.url).toBe('https://example.test/scene.png');
    expect(result.current.genErrorByMessage['dm-1']).toBeUndefined();
  });

  it('refuses to generate for a message with no id, so no unsavable image shows', async () => {
    const { result } = setup();
    const idLess = {
      sender: 'dm',
      text: 'The bell rings over the square.',
      timestamp: '2026-11-03T00:00:00.000Z',
    } as unknown as ChatMessage;

    await act(async () => {
      await result.current.handleGenerateScene(idLess);
    });

    expect(generateSceneImage).not.toHaveBeenCalled();
    expect(appendMessageImage).not.toHaveBeenCalled();
    expect(result.current.imageByMessage).toEqual({});
    expect(result.current.genErrorByMessage['2026-11-03T00:00:00.000Z']).toBe(
      'This message is not saved yet.',
    );
  });
});
