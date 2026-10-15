import { vi } from 'vitest';

type TokenServiceModule = Record<string, unknown>;

const isClass = (value: unknown): boolean =>
  typeof value === 'function' && /^class\s/.test(Function.prototype.toString.call(value));

/**
 * Factory body for `vi.mock('@/services/auth/TokenService', ...)`.
 * Every function export of the real module becomes an inert `vi.fn()`, classes and
 * constants keep their real value, and `overrides` win. A new export added to
 * TokenService.ts is stubbed automatically, so no test needs an edit.
 */
export const createTokenServiceMock = async (
  importOriginal: () => Promise<unknown>,
  overrides: TokenServiceModule = {},
): Promise<TokenServiceModule> => {
  const actual = (await importOriginal()) as TokenServiceModule;
  const stubbed: TokenServiceModule = {};
  for (const [name, value] of Object.entries(actual)) {
    stubbed[name] = typeof value === 'function' && !isClass(value) ? vi.fn() : value;
  }
  return { ...stubbed, ...overrides };
};
