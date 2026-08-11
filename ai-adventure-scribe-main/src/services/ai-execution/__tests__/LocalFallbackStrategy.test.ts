import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LocalFallbackStrategy } from '../LocalFallbackStrategy';

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
  },
}));

describe('LocalFallbackStrategy', () => {
  let strategy: LocalFallbackStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new LocalFallbackStrategy(7);
  });

  it('has a name and priority', () => {
    expect(strategy.name).toBe('local-fallback');
    expect(strategy.priority).toBe(7);
  });

  it('only handles the still-supported rules compatibility call', () => {
    expect(strategy.canExecute('rules-interpreter-execute')).toBe(true);
    expect(strategy.canExecute('dm-agent-execute')).toBe(false);
    expect(strategy.canExecute('other-function')).toBe(false);
  });

  it('returns the local rules validation result', async () => {
    await expect(strategy.execute('rules-interpreter-execute')).resolves.toEqual({
      isValid: true,
      suggestions: [],
      errors: [],
      explanation: 'Local rules validation - action appears valid',
    });
  });

  it('rejects retired DM execution instead of returning a narration stub', async () => {
    await expect(strategy.execute('dm-agent-execute')).rejects.toThrow(
      'Unsupported local AI function: dm-agent-execute',
    );
  });
});
