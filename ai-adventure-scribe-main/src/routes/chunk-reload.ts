/**
 * A deploy removes the previous build's hashed chunks. A tab still running
 * that build then fails the next lazy import. Reload once so the new
 * index.html is fetched. The session flag stops a broken chunk from looping.
 */

export const CHUNK_RELOAD_FLAG = 'ir-chunk-reload';

const CHUNK_LOAD_MESSAGES = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
];

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_LOAD_MESSAGES.some((part) => message.includes(part));
}

function readFlag(): string | null {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_FLAG);
  } catch {
    return 'unavailable';
  }
}

/** True when this tab already reloaded for a missing chunk. */
export function chunkReloadAlreadyAttempted(): boolean {
  return readFlag() === '1';
}

let reloadPage = (): void => {
  window.location.reload();
};

/** Test-only. jsdom will not replace location.reload. Production leaves this unset. */
export function setChunkReloadForTests(reload: (() => void) | undefined): void {
  reloadPage = reload ?? (() => window.location.reload());
}

function reloadOnce(): boolean {
  if (readFlag() !== null) return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  } catch {
    return false;
  }
  reloadPage();
  return true;
}

/**
 * Reload once for a missing lazy chunk. Returns true when a reload was started.
 * A second failure in the same tab returns false so the error UI can show.
 */
export function reloadOnceForChunkError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  return reloadOnce();
}

function onVitePreloadError(event: Event): void {
  if (reloadOnce()) event.preventDefault();
}

let chunkReloadListenerInstalled = false;

/** Vite fires this when a preloaded dynamic import fails. */
export function installChunkReloadListener(): void {
  if (chunkReloadListenerInstalled) return;
  chunkReloadListenerInstalled = true;
  window.addEventListener('vite:preloadError', onVitePreloadError);
}

/** Test-only. Production installs the listener once at startup. */
export function uninstallChunkReloadListenerForTests(): void {
  window.removeEventListener('vite:preloadError', onVitePreloadError);
  chunkReloadListenerInstalled = false;
}
