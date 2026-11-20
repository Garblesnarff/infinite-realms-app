import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHUNK_RELOAD_BUILD_KEY,
  CHUNK_RELOAD_FLAG,
  chunkReloadAlreadyAttempted,
  installChunkReloadListener,
  isChunkLoadError,
  reloadOnceForChunkError,
  setChunkReloadForTests,
  uninstallChunkReloadListenerForTests,
} from '../chunk-reload';

describe('chunk reload after a deploy (#822)', () => {
  afterEach(() => {
    sessionStorage.clear();
    setChunkReloadForTests(undefined);
    uninstallChunkReloadListenerForTests();
    vi.restoreAllMocks();
  });

  it('recognizes the browser messages for a missing dynamic import', () => {
    expect(
      isChunkLoadError(
        new Error('Failed to fetch dynamically imported module: /assets/character-list-abc.js'),
      ),
    ).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed'))).toBe(true);
    expect(isChunkLoadError(new Error('kaboom'))).toBe(false);
  });

  it('reloads once, then leaves the next failure for the error card', () => {
    const reload = vi.fn();
    setChunkReloadForTests(reload);
    const missing = new Error(
      'Failed to fetch dynamically imported module: /assets/character-list-abc.js',
    );

    expect(reloadOnceForChunkError(missing)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBe('1');

    expect(reloadOnceForChunkError(missing)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(chunkReloadAlreadyAttempted()).toBe(true);
  });

  it('reloads again after a later deploy, when the spent reload belongs to an older build (#1671)', () => {
    // First deploy: this tab spent its reload on build "older-build". The tab stays open.
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
    sessionStorage.setItem(CHUNK_RELOAD_BUILD_KEY, 'older-build');

    const reload = vi.fn();
    setChunkReloadForTests(reload);
    const missing = new Error(
      'Failed to fetch dynamically imported module: /assets/character-list-def.js',
    );

    // Second deploy: the running build differs from the one that spent the reload.
    expect(reloadOnceForChunkError(missing)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for an ordinary error', () => {
    const reload = vi.fn();
    setChunkReloadForTests(reload);
    expect(reloadOnceForChunkError(new Error('kaboom'))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBeNull();
  });

  it('stops a second vite preload error from reloading', () => {
    const reload = vi.fn();
    setChunkReloadForTests(reload);
    installChunkReloadListener();

    const first = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    const second = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
