
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  validateEnvironment,
  getRequiredEnv,
  getOptionalEnv,
} from '../env-validation';

import { logger } from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('env-validation', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn();
    // Reset env vars we care about
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'a'.repeat(21));
    vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST');
    vi.stubEnv('MODE', 'development');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    console.error = originalConsoleError;
  });

  describe('validateEnvironment', () => {
    it('should return isValid: true when all required variables are present and valid', () => {
      const result = validateEnvironment();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Environment validation successful'), expect.any(Object));
    });

    it('should return isValid: false when required variables are missing in development', () => {
      vi.stubEnv('VITE_SUPABASE_URL', '');
      vi.stubEnv('MODE', 'development');

      const result = validateEnvironment();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: VITE_SUPABASE_URL (Supabase project URL)');
      expect(logger.error).toHaveBeenCalledWith('Required environment variable not configured', expect.objectContaining({
        variable: 'VITE_SUPABASE_URL'
      }));
      expect(console.error).toHaveBeenCalled();
    });

    it('should return isValid: false but not console.error in production when required variables are missing', () => {
      vi.stubEnv('VITE_SUPABASE_URL', '');
      vi.stubEnv('MODE', 'production');

      const result = validateEnvironment();
      expect(result.isValid).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith('Required environment variable not configured in production', expect.any(Object));
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should add warnings for invalid formats', () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'http://invalid.com'); // missing s in https

      const result = validateEnvironment();
      expect(result.isValid).toBe(true); // Still valid because it's present
      expect(result.warnings).toContain('Invalid format for VITE_SUPABASE_URL: Supabase project URL');
      expect(logger.warn).toHaveBeenCalledWith('Environment variable has invalid format', expect.objectContaining({
        variable: 'VITE_SUPABASE_URL'
      }));
    });

    it('should handle optional variables missing', () => {
      vi.stubEnv('VITE_GA_MEASUREMENT_ID', '');

      const result = validateEnvironment();
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Optional environment variable not set: VITE_GA_MEASUREMENT_ID (Google Analytics measurement ID)');
      expect(logger.debug).toHaveBeenCalledWith('Optional environment variable not set', expect.any(Object));
    });

    it('should accept valid api.infiniterealms.app URLs', () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://api.infiniterealms.app');
      const result = validateEnvironment();
      expect(result.isValid).toBe(true);
      expect(result.warnings).not.toContain(expect.stringContaining('VITE_SUPABASE_URL'));
    });
  });

  describe('getRequiredEnv', () => {
    it('should return the value when present', () => {
      vi.stubEnv('VITE_TEST_VAR', 'test-value');
      const result = getRequiredEnv('VITE_TEST_VAR', 'test description');
      expect(result).toBe('test-value');
    });

    it('should throw error in development when missing', () => {
      vi.stubEnv('MODE', 'development');
      vi.stubEnv('VITE_MISSING_VAR', '');

      expect(() => getRequiredEnv('VITE_MISSING_VAR', 'desc')).toThrow('Missing required environment variable: VITE_MISSING_VAR (desc)');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should return empty string and warn in production when missing', () => {
      vi.stubEnv('MODE', 'production');
      vi.stubEnv('VITE_MISSING_VAR', '');

      const result = getRequiredEnv('VITE_MISSING_VAR', 'desc');
      expect(result).toBe('');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('getOptionalEnv', () => {
    it('should return the value when present', () => {
      vi.stubEnv('VITE_OPTIONAL_VAR', 'present');
      const result = getOptionalEnv('VITE_OPTIONAL_VAR', 'default');
      expect(result).toBe('present');
    });

    it('should return default value when missing', () => {
      vi.stubEnv('VITE_OPTIONAL_VAR', '');
      const result = getOptionalEnv('VITE_OPTIONAL_VAR', 'default');
      expect(result).toBe('default');
      expect(logger.debug).toHaveBeenCalledWith('Using default value for optional environment variable', expect.any(Object));
    });
  });
});
