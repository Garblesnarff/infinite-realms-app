/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useToast, toast } from '../use-toast';

vi.mock('sonner', () => {
  const mockToast = vi.fn(() => 'mock-id');
  (mockToast as any).error = vi.fn(() => 'error-id');
  (mockToast as any).dismiss = vi.fn();
  return {
    toast: mockToast,
  };
});

describe('use-toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('toast() function', () => {
    it('should call sonnerToast with title and description', () => {
      toast({ title: 'Success', description: 'Operation completed' });
      expect(sonnerToast).toHaveBeenCalledWith('Success', { description: 'Operation completed' });
    });

    it('should call sonnerToast with description only', () => {
      toast({ description: 'Operation completed' });
      expect(sonnerToast).toHaveBeenCalledWith('Operation completed');
    });

    it('should call sonnerToast with title only', () => {
      toast({ title: 'Success' });
      expect(sonnerToast).toHaveBeenCalledWith('Success');
    });

    it('should pass an action and duration through to sonner', () => {
      const onClick = vi.fn();
      toast({
        title: 'New version available',
        description: 'Refresh to load the latest version.',
        action: { label: 'Refresh', onClick },
        duration: Infinity,
      });

      expect(sonnerToast).toHaveBeenCalledWith('New version available', {
        description: 'Refresh to load the latest version.',
        action: { label: 'Refresh', onClick },
        duration: Infinity,
      });
    });

    it('should call sonnerToast.error for destructive variant with title and description', () => {
      toast({ title: 'Error', description: 'Operation failed', variant: 'destructive' });
      expect(sonnerToast.error).toHaveBeenCalledWith('Error', { description: 'Operation failed' });
    });

    it('should call sonnerToast.error for destructive variant with description only', () => {
      toast({ description: 'Operation failed', variant: 'destructive' });
      expect(sonnerToast.error).toHaveBeenCalledWith('Operation failed');
    });

    it('should return an object with id and dismiss method', () => {
      const result = toast({ title: 'Test' });
      expect(result.id).toBe('mock-id');
      expect(typeof result.dismiss).toBe('function');

      result.dismiss();
      expect(sonnerToast.dismiss).toHaveBeenCalledWith('mock-id');
    });

    it('should have a no-op update method', () => {
      const result = toast({ title: 'Test' });
      expect(typeof result.update).toBe('function');
      result.update({ title: 'New' });
      // Just verifying it doesn't crash as it's a no-op
    });
  });

  describe('useToast() hook', () => {
    it('should return toast and dismiss methods', () => {
      const { result } = renderHook(() => useToast());
      expect(typeof result.current.toast).toBe('function');
      expect(typeof result.current.dismiss).toBe('function');
    });

    it('should call sonnerToast.dismiss with id when dismiss is called with id', () => {
      const { result } = renderHook(() => useToast());
      result.current.dismiss('test-id');
      expect(sonnerToast.dismiss).toHaveBeenCalledWith('test-id');
    });

    it('should call sonnerToast.dismiss without args when dismiss is called without args', () => {
      const { result } = renderHook(() => useToast());
      result.current.dismiss();
      expect(sonnerToast.dismiss).toHaveBeenCalledWith();
    });
  });
});
