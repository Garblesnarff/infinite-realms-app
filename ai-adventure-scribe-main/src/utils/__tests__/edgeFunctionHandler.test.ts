/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { toast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { AIExecutionManager } from '@/services/ai-execution/AIExecutionManager';
import { EdgeFunctionStrategy } from '@/services/ai-execution/EdgeFunctionStrategy';
import { LocalFallbackStrategy } from '@/services/ai-execution/LocalFallbackStrategy';

// Mock dependencies
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/ai-execution/AIExecutionManager', () => {
  return {
    AIExecutionManager: vi.fn().mockImplementation(() => ({
      execute: vi.fn().mockResolvedValue({ result: 'success' }),
    })),
  };
});

vi.mock('@/services/ai-execution/EdgeFunctionStrategy', () => {
  return {
    EdgeFunctionStrategy: vi.fn().mockImplementation((priority) => ({
      priority,
      name: 'EdgeFunctionStrategy',
      canExecute: vi.fn().mockReturnValue(true),
      execute: vi.fn(),
    })),
  };
});

vi.mock('@/services/ai-execution/LocalFallbackStrategy', () => {
  return {
    LocalFallbackStrategy: vi.fn().mockImplementation((priority) => ({
      priority,
      name: 'LocalFallbackStrategy',
      canExecute: vi.fn().mockReturnValue(true),
      execute: vi.fn(),
    })),
  };
});

describe('edgeFunctionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default env state
    vi.stubEnv('VITE_USE_LOCAL_AI', 'false');
    vi.stubEnv('DEV', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should call execute on AIExecutionManager and return data', async () => {
    const { callEdgeFunction } = await import('../edgeFunctionHandler');
    const mockData = { result: 'success' };

    // Setup the mock manager's execute method
    const mockExecute = vi.fn().mockResolvedValue(mockData);
    (AIExecutionManager as any).mockImplementation(() => ({
      execute: mockExecute,
    }));

    const result = await callEdgeFunction('test-function', { param: 'value' });

    expect(result).toEqual(mockData);
    expect(mockExecute).toHaveBeenCalledWith('test-function', { param: 'value' });
  });

  it('should handle errors, log them, and show a toast', async () => {
    const { callEdgeFunction } = await import('../edgeFunctionHandler');
    const mockError = new Error('Execution failed');

    (AIExecutionManager as any).mockImplementation(() => ({
      execute: vi.fn().mockRejectedValue(mockError),
    }));

    const result = await callEdgeFunction('test-function');

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to call test-function'),
      mockError
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error',
        variant: 'destructive',
      })
    );
  });

  it('should use LocalFallbackStrategy with priority 1 when VITE_USE_LOCAL_AI is true', async () => {
    vi.stubEnv('VITE_USE_LOCAL_AI', 'true');

    const { callEdgeFunction } = await import('../edgeFunctionHandler');
    await callEdgeFunction('test');

    expect(LocalFallbackStrategy).toHaveBeenCalledWith(1);
    expect(EdgeFunctionStrategy).toHaveBeenCalledWith(10);
  });

  it('should use EdgeFunctionStrategy with priority 1 when in production and VITE_USE_LOCAL_AI is false', async () => {
    // Note: We need to make sure import.meta.env.DEV is false to hit this branch.
    // In Vitest, we can use vi.mock to mock import.meta.env if needed,
    // but often stubEnv works if the code uses process.env or if Vitest is configured.
    // However, the code uses import.meta.env directly.

    // Let's try to hit the false branch of the ternary.
    // In our test environment, import.meta.env.DEV is likely true.
    // So we MUST set VITE_USE_LOCAL_AI to something that doesn't trigger localFirst if we want to test the other branch,
    // but the logic is: return useLocal === 'true' || import.meta.env.DEV;
    // So if import.meta.env.DEV is true, localFirst is ALWAYS true.

    // To test the other branch, we'd need to mock import.meta.env.
    // Vitest provides a way to do this.

    // @ts-ignore - Mocking import.meta.env.DEV for testing prioritization logic
    import.meta.env.DEV = false;
    vi.stubEnv('VITE_USE_LOCAL_AI', 'false');

    const { callEdgeFunction } = await import('../edgeFunctionHandler');
    await callEdgeFunction('test');

    expect(EdgeFunctionStrategy).toHaveBeenCalledWith(1);
    expect(LocalFallbackStrategy).toHaveBeenCalledWith(10);

    // Reset it for other tests
    // @ts-ignore - Restoring import.meta.env.DEV after testing prioritization logic
    import.meta.env.DEV = true;
  });

  it('should reuse the same manager instance if local mode does not change', async () => {
    const { callEdgeFunction } = await import('../edgeFunctionHandler');

    await callEdgeFunction('test1');
    await callEdgeFunction('test2');

    // Should only create the manager once
    expect(AIExecutionManager).toHaveBeenCalledTimes(1);
  });

  it('should create a new manager instance if local mode changes', async () => {
    vi.stubEnv('VITE_USE_LOCAL_AI', 'true');
    const { callEdgeFunction: call1 } = await import('../edgeFunctionHandler');
    await call1('test1');
    expect(AIExecutionManager).toHaveBeenCalledTimes(1);

    // Change environment to force a new manager creation
    // We need to change the result of shouldUseLocalServices()
    // @ts-ignore - Mocking import.meta.env.DEV to simulate environment change
    import.meta.env.DEV = false;
    vi.stubEnv('VITE_USE_LOCAL_AI', 'false');

    // Since we can't easily reset the module's internal state without vi.resetModules(),
    // and vi.resetModules() will clear the cachedManager.

    await call1('test2');

    expect(AIExecutionManager).toHaveBeenCalledTimes(2);

    // Reset it
    // @ts-ignore - Restoring import.meta.env.DEV after environment simulation
    import.meta.env.DEV = true;
  });
});
