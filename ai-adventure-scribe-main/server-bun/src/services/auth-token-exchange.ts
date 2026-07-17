import crypto from 'crypto';

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

interface PendingAuthTokenPair {
  tokens: AuthTokenPair;
  expiresAt: number;
}

export const AUTH_TOKEN_EXCHANGE_TTL_MS = 60_000;

/**
 * Short-lived hand-off for OAuth tokens between the server callback and the SPA.
 *
 * This is deliberately in-memory for the current single-instance deployment.
 * Move it to shared storage before running more than one API instance.
 */
export class AuthTokenExchangeCodeStore {
  private readonly codes = new Map<string, PendingAuthTokenPair>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = AUTH_TOKEN_EXCHANGE_TTL_MS,
  ) {}

  issue(tokens: AuthTokenPair): string {
    this.removeExpired();

    const code = crypto.randomUUID();
    this.codes.set(code, {
      tokens,
      expiresAt: this.now() + this.ttlMs,
    });
    return code;
  }

  consume(code: string): AuthTokenPair | null {
    const pending = this.codes.get(code);
    // Delete first so concurrent/replayed reads can never receive the same tokens.
    this.codes.delete(code);

    if (!pending || pending.expiresAt <= this.now()) {
      return null;
    }

    return pending.tokens;
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [code, pending] of this.codes) {
      if (pending.expiresAt <= now) {
        this.codes.delete(code);
      }
    }
  }
}

export const authTokenExchangeCodes = new AuthTokenExchangeCodeStore();
