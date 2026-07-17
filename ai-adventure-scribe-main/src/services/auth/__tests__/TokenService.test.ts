/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getAccessToken,
  getAuthHeaders,
  getTokenExpiry,
  isTokenExpiringSoon,
  refreshAccessToken,
  loadCachedSession,
  persistSession,
  SESSION_STORAGE_KEY,
} from '../TokenService';

import logger from '@/lib/logger';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('TokenService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));

    // Mock localStorage and sessionStorage
    const storageMock = () => {
      let store: Record<string, string> = {};
      return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value.toString();
        }),
        removeItem: vi.fn((key: string) => {
          delete store[key];
        }),
        clear: vi.fn(() => {
          store = {};
        }),
      };
    };

    vi.stubGlobal('localStorage', storageMock());
    vi.stubGlobal('sessionStorage', storageMock());
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('getAccessToken', () => {
    it('reads the current WorkOS token from localStorage', () => {
      localStorage.setItem('workos_access_token', 'access');

      expect(getAccessToken()).toBe('access');
    });

    it('returns null when no WorkOS token is stored', () => {
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('getAuthHeaders', () => {
    it('returns an authorization header when a WorkOS token is stored', () => {
      localStorage.setItem('workos_access_token', 'access');

      expect(getAuthHeaders()).toEqual({ Authorization: 'Bearer access' });
    });

    it('returns no authorization header when anonymous requests are allowed', () => {
      expect(getAuthHeaders()).toEqual({});
    });

    it('preserves the legacy empty bearer header when requested', () => {
      expect(getAuthHeaders({ includeEmptyToken: true })).toEqual({ Authorization: 'Bearer ' });
    });
  });

  describe('getTokenExpiry', () => {
    it('should return expiry in milliseconds for a valid token', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = 'a.' + btoa(JSON.stringify({ exp })) + '.b';
      expect(getTokenExpiry(token)).toBe(exp * 1000);
    });

    it('should return null for token without exp', () => {
      const token = 'a.' + btoa(JSON.stringify({ foo: 'bar' })) + '.b';
      expect(getTokenExpiry(token)).toBeNull();
    });

    it('should return null for malformed token', () => {
      expect(getTokenExpiry('invalid-token')).toBeNull();
      expect(getTokenExpiry('a.b')).toBeNull();
    });

    it('should return null for non-base64 payload', () => {
      expect(getTokenExpiry('a.!!!.b')).toBeNull();
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('should return false for token with far expiry', () => {
      const exp = Math.floor(Date.now() / 1000) + 7200; // 2 hours
      const token = 'a.' + btoa(JSON.stringify({ exp })) + '.b';
      expect(isTokenExpiringSoon(token)).toBe(false);
    });

    it('should return true for token with near expiry', () => {
      const exp = Math.floor(Date.now() / 1000) + 30; // 30 seconds (margin is 60s)
      const token = 'a.' + btoa(JSON.stringify({ exp })) + '.b';
      expect(isTokenExpiringSoon(token)).toBe(true);
    });

    it('should return true for expired token', () => {
      const exp = Math.floor(Date.now() / 1000) - 3600;
      const token = 'a.' + btoa(JSON.stringify({ exp })) + '.b';
      expect(isTokenExpiringSoon(token)).toBe(true);
    });

    it('should return true for invalid token', () => {
      expect(isTokenExpiringSoon('invalid')).toBe(true);
    });
  });

  describe('refreshAccessToken', () => {
    it('should return new tokens on successful refresh', async () => {
      const mockResponse = {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      };
      (fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await refreshAccessToken('old-refresh');
      expect(result).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/auth/refresh'), expect.any(Object));
    });

    it('should return null and log warning on failed refresh', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = await refreshAccessToken('old-refresh');
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should return null and log error on fetch exception', async () => {
      (fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await refreshAccessToken('old-refresh');
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('loadCachedSession', () => {
    it('should load session from individual localStorage keys', () => {
      localStorage.setItem('workos_access_token', 'access');
      localStorage.setItem('workos_refresh_token', 'refresh');

      const session = loadCachedSession();
      expect(session).toEqual({
        access_token: 'access',
        refresh_token: 'refresh',
      });
    });

    it('should prioritize sessionStorage for refresh token', () => {
      localStorage.setItem('workos_access_token', 'access');
      localStorage.setItem('workos_refresh_token', 'local-refresh');
      sessionStorage.setItem('workos_refresh_token', 'session-refresh');

      const session = loadCachedSession();
      expect(session?.refresh_token).toBe('session-refresh');
    });

    it('should fallback to SESSION_STORAGE_KEY if individual keys missing', () => {
      const oldSession = { access_token: 'old-access', refresh_token: 'old-refresh' };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(oldSession));

      const session = loadCachedSession();
      expect(session).toEqual(oldSession);
    });

    it('should return null if no session cached', () => {
      expect(loadCachedSession()).toBeNull();
    });

    it('should return null and log warning for malformed old session', () => {
      localStorage.setItem(SESSION_STORAGE_KEY, 'invalid-json');
      const session = loadCachedSession();
      expect(session).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('persistSession', () => {
    it('should save session to all expected keys', () => {
      const session = { access_token: 'access', refresh_token: 'refresh' };
      persistSession(session);

      expect(localStorage.setItem).toHaveBeenCalledWith('workos_access_token', 'access');
      expect(sessionStorage.setItem).toHaveBeenCalledWith('workos_refresh_token', 'refresh');
      expect(localStorage.setItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY, JSON.stringify(session));
      expect(localStorage.removeItem).toHaveBeenCalledWith('workos_refresh_token');
    });

    it('should handle session without refresh token', () => {
      const session = { access_token: 'access' };
      persistSession(session);

      expect(localStorage.setItem).toHaveBeenCalledWith('workos_access_token', 'access');
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('workos_refresh_token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('workos_refresh_token');
    });

    it('should remove all keys when passing null', () => {
      persistSession(null);

      expect(localStorage.removeItem).toHaveBeenCalledWith('workos_access_token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('workos_refresh_token');
      expect(sessionStorage.removeItem).toHaveBeenCalledWith('workos_refresh_token');
      expect(localStorage.removeItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    });
  });
});
