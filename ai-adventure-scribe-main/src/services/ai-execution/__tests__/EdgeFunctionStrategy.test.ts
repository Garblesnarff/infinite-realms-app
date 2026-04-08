/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { EdgeFunctionStrategy } from '../EdgeFunctionStrategy';

import { supabase } from '@/integrations/supabase/client';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe('EdgeFunctionStrategy', () => {
  let strategy: EdgeFunctionStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new EdgeFunctionStrategy(5);
  });

  it('should have a name and priority', () => {
    expect(strategy.name).toBe('supabase-edge-function');
    expect(strategy.priority).toBe(5);
  });

  it('should return true for canExecute', () => {
    expect(strategy.canExecute()).toBe(true);
  });

  it('should successfully invoke a function', async () => {
    const mockData = { result: 'success' };
    (supabase.functions.invoke as any).mockResolvedValue({ data: mockData, error: null });

    const result = await strategy.execute('test-function', { foo: 'bar' });

    expect(supabase.functions.invoke).toHaveBeenCalledWith('test-function', {
      body: { foo: 'bar' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(result).toEqual(mockData);
  });

  it('should throw error when invocation fails', async () => {
    const mockError = new Error('Invocation failed');
    (supabase.functions.invoke as any).mockResolvedValue({ data: null, error: mockError });

    await expect(strategy.execute('test-function')).rejects.toThrow('Invocation failed');
  });

  it('should serialize Date objects in payload', async () => {
    const date = new Date('2025-01-01T12:00:00Z');
    const payload = {
      timestamp: date,
      nested: {
        createdAt: date,
        list: [date, { d: date }],
      },
    };

    (supabase.functions.invoke as any).mockResolvedValue({ data: {}, error: null });

    await strategy.execute('test-function', payload);

    const isoDate = date.toISOString();
    expect(supabase.functions.invoke).toHaveBeenCalledWith('test-function', {
      body: {
        timestamp: isoDate,
        nested: {
          createdAt: isoDate,
          list: [isoDate, { d: isoDate }],
        },
      },
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('should handle null and undefined in payload', async () => {
    const payload = {
      foo: null,
      bar: undefined,
    };

    (supabase.functions.invoke as any).mockResolvedValue({ data: {}, error: null });

    await strategy.execute('test-function', payload);

    expect(supabase.functions.invoke).toHaveBeenCalledWith('test-function', {
      body: {
        foo: null,
        bar: undefined,
      },
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
