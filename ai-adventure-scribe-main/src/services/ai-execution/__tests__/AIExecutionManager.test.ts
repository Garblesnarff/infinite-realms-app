/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AIExecutionManager } from '../AIExecutionManager';

import type { AIExecutionStrategy } from '../AIExecutionStrategy';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AIExecutionManager', () => {
  let strategy1: AIExecutionStrategy;
  let strategy2: AIExecutionStrategy;

  beforeEach(() => {
    vi.clearAllMocks();

    strategy1 = {
      name: 'strategy1',
      priority: 10,
      canExecute: vi.fn().mockReturnValue(true),
      execute: vi.fn().mockResolvedValue({ success: true, from: 'strategy1' }),
    };

    strategy2 = {
      name: 'strategy2',
      priority: 5,
      canExecute: vi.fn().mockReturnValue(true),
      execute: vi.fn().mockResolvedValue({ success: true, from: 'strategy2' }),
    };
  });

  it('should sort strategies by priority', async () => {
    const manager = new AIExecutionManager([strategy1, strategy2]);
    await manager.execute('test-function');

    // strategy2 has priority 5, strategy1 has 10. strategy2 should be called first.
    expect(strategy2.execute).toHaveBeenCalled();
    expect(strategy1.execute).not.toHaveBeenCalled();
  });

  it('should filter strategies by canExecute', async () => {
    (strategy2.canExecute as any).mockReturnValue(false);
    const manager = new AIExecutionManager([strategy1, strategy2]);
    const result = await manager.execute('test-function');

    expect(strategy2.execute).not.toHaveBeenCalled();
    expect(strategy1.execute).toHaveBeenCalled();
    expect(result).toEqual({ success: true, from: 'strategy1' });
  });

  it('should throw error if no strategy can execute', async () => {
    (strategy1.canExecute as any).mockReturnValue(false);
    (strategy2.canExecute as any).mockReturnValue(false);
    const manager = new AIExecutionManager([strategy1, strategy2]);

    await expect(manager.execute('test-function')).rejects.toThrow(
      'No execution strategy available for test-function'
    );
  });

  it('should fallback to next strategy if first one fails', async () => {
    (strategy2.execute as any).mockRejectedValue(new Error('Strategy 2 failed'));
    const manager = new AIExecutionManager([strategy1, strategy2]);
    const result = await manager.execute('test-function');

    expect(strategy2.execute).toHaveBeenCalled();
    expect(strategy1.execute).toHaveBeenCalled();
    expect(result).toEqual({ success: true, from: 'strategy1' });
  });

  it('should not fallback if fallbackOnFailure is false', async () => {
    (strategy2.execute as any).mockRejectedValue(new Error('Strategy 2 failed'));
    const manager = new AIExecutionManager([strategy1, strategy2]);

    await expect(
      manager.execute('test-function', {}, { fallbackOnFailure: false })
    ).rejects.toThrow('Strategy 2 failed');
    expect(strategy1.execute).not.toHaveBeenCalled();
  });

  it('should throw last error if all strategies fail', async () => {
    (strategy1.execute as any).mockRejectedValue(new Error('Strategy 1 failed'));
    (strategy2.execute as any).mockRejectedValue(new Error('Strategy 2 failed'));
    const manager = new AIExecutionManager([strategy1, strategy2]);

    await expect(manager.execute('test-function')).rejects.toThrow('Strategy 1 failed');
  });

  it('should throw generic error if all strategies fail with non-Error object', async () => {
    (strategy1.execute as any).mockRejectedValue('String error 1');
    (strategy2.execute as any).mockRejectedValue('String error 2');
    const manager = new AIExecutionManager([strategy1, strategy2]);

    await expect(manager.execute('test-function')).rejects.toThrow(
      'All strategies failed for test-function'
    );
  });
});
