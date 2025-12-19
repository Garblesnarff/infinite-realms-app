/**
 * Global Auth Gate
 *
 * Blocks API calls until auth verification is complete.
 * This prevents race conditions where components make API calls
 * with expired tokens before the auth system can verify/clear them.
 *
 * Usage:
 * - AuthContext calls resetAuthGate() when starting auth verification
 * - AuthContext calls markAuthReady() when verification completes
 * - API clients call await waitForAuth() before making requests
 */

let authReadyResolve: (() => void) | null = null;
let authReadyPromise: Promise<void> | null = null;
let isAuthReady = false;

/**
 * Reset the auth gate - called when starting auth verification.
 * This blocks all API calls until markAuthReady() is called.
 */
export function resetAuthGate() {
  isAuthReady = false;
  authReadyPromise = new Promise((resolve) => {
    authReadyResolve = resolve;
  });
}

/**
 * Mark auth as ready - called when auth verification completes.
 * This unblocks all waiting API calls.
 */
export function markAuthReady() {
  isAuthReady = true;
  if (authReadyResolve) {
    authReadyResolve();
    authReadyResolve = null;
  }
}

/**
 * Wait for auth verification to complete.
 * Returns immediately if auth is already verified.
 * API clients should call this before making authenticated requests.
 */
export async function waitForAuth(): Promise<void> {
  if (isAuthReady) return;
  if (authReadyPromise) await authReadyPromise;
}

/**
 * Check if auth has been verified.
 * Useful for synchronous checks when async waiting isn't possible.
 */
export function isAuthVerified(): boolean {
  return isAuthReady;
}

// Initialize the gate on module load
// This ensures API calls wait until the first auth check completes
resetAuthGate();
