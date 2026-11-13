/**
 * Listen prepare limits and messages (#1348).
 *
 * A Listen click that takes longer than VOICE_PREPARE_TIMEOUT_MS to prepare is
 * cancelled and shows VOICE_PREPARE_TIMEOUT_MESSAGE with Try again. The server
 * proxy gives up on its own upstream call after 120 s, so without this bound a
 * player waits minutes for nothing.
 */

/** How long one segment may take to prepare before the Listen is cancelled. */
export const VOICE_PREPARE_TIMEOUT_MS = 60_000;

export const VOICE_PREPARE_TIMEOUT_MESSAGE = 'Voice took too long to prepare';

/** Toast title, announced once per page load, when a clip comes from Standard instead of premium. */
export const STANDARD_FALLBACK_NOTICE_TITLE = 'Using the standard voice';
