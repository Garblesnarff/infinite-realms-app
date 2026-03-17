
import { toast } from 'sonner';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  handleAsyncError,
  withErrorHandling,
  handleAPIError,
  handleValidationError,
} from '../error-handler';

import logger from '@/lib/logger';


// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('error-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleAsyncError', () => {
    it('should log the error and show a toast by default', () => {
      const error = new Error('Test error');
      handleAsyncError(error);

      expect(logger.error).toHaveBeenCalledWith('Error: An error occurred', expect.objectContaining({
        error,
        errorMessage: 'Test error',
      }));
      expect(toast.error).toHaveBeenCalledWith('An error occurred', expect.objectContaining({
        description: 'Test error',
      }));
    });

    it('should use custom user message and log level', () => {
      const error = new Error('Test error');
      handleAsyncError(error, {
        userMessage: 'Custom message',
        logLevel: 'warn',
      });

      expect(logger.warn).toHaveBeenCalledWith('Error: Custom message', expect.any(Object));
      expect(toast.error).toHaveBeenCalledWith('Custom message', expect.any(Object));
    });

    it('should not show toast when showToast is false', () => {
      const error = new Error('Test error');
      handleAsyncError(error, { showToast: false });

      expect(toast.error).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should execute onError callback', () => {
      const error = new Error('Test error');
      const onError = vi.fn();
      handleAsyncError(error, { onError });

      expect(onError).toHaveBeenCalledWith(error);
    });

    it('should handle non-Error objects', () => {
      const error = 'String error';
      handleAsyncError(error);

      expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        errorMessage: 'String error',
      }));
      expect(toast.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        description: 'String error',
      }));
    });

    it('should include additional context in logs', () => {
      const error = new Error('Test error');
      handleAsyncError(error, { context: { userId: '123' } });

      expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        userId: '123',
      }));
    });

    it('should handle errors in the custom onError callback gracefully', () => {
        const error = new Error('Initial error');
        const onError = vi.fn(() => {
          throw new Error('Callback error');
        });

        // This should not throw
        handleAsyncError(error, { onError });

        expect(onError).toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith('Error in custom error handler:', expect.any(Error));
      });
  });

  describe('withErrorHandling', () => {
    it('should return a wrapped function that executes correctly', async () => {
      const mockFn = vi.fn().mockResolvedValue('success');
      const wrapped = withErrorHandling(mockFn);

      const result = await wrapped('arg1', 2);
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledWith('arg1', 2);
    });

    it('should catch errors, handle them, and re-throw', async () => {
      const error = new Error('Async failure');
      const mockFn = vi.fn().mockRejectedValue(error);
      const wrapped = withErrorHandling(mockFn, { userMessage: 'Failed to execute' });

      await expect(wrapped()).rejects.toThrow(error);
      expect(toast.error).toHaveBeenCalledWith('Failed to execute', expect.any(Object));
    });
  });

  describe('handleAPIError', () => {
    it('should handle network errors', () => {
      const error = new Error('Failed to fetch');
      handleAPIError(error);
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Network connection error'), expect.any(Object));
    });

    it('should handle timeout errors', () => {
      const error = new Error('The request timed out');
      handleAPIError(error);
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('timed out'), expect.any(Object));
    });

    it('should handle unauthorized errors', () => {
      const error = new Error('401 Unauthorized');
      handleAPIError(error);
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Authentication required'), expect.any(Object));
    });

    it('should handle forbidden errors', () => {
      const error = new Error('403 Forbidden');
      handleAPIError(error);
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('do not have permission'), expect.any(Object));
    });

    it('should handle not found errors', () => {
      const error = new Error('404 Not Found');
      handleAPIError(error);
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('not found'), expect.any(Object));
    });

    it('should handle server errors', () => {
      const error = new Error('500 Internal Server Error');
      handleAPIError(error);
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Server error'), expect.any(Object));
    });

    it('should use custom message if provided even for known error types', () => {
      const error = new Error('404 Not Found');
      handleAPIError(error, { userMessage: 'Custom Not Found' });
      expect(toast.error).toHaveBeenCalledWith('Custom Not Found', expect.any(Object));
    });
  });

  describe('handleValidationError', () => {
    it('should log a warning and show a toast', () => {
      handleValidationError('Invalid input');

      expect(logger.warn).toHaveBeenCalledWith('Validation error:', 'Invalid input');
      expect(toast.error).toHaveBeenCalledWith('Validation Error', expect.objectContaining({
        description: 'Invalid input',
      }));
    });

    it('should call onError with a new Error', () => {
      const onError = vi.fn();
      handleValidationError('Invalid input', { onError });

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe('Invalid input');
    });

    it('should respect showToast: false', () => {
        handleValidationError('Invalid input', { showToast: false });
        expect(toast.error).not.toHaveBeenCalled();
    });
  });
});
