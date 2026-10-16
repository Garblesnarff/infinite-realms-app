import { describe, expect, it, vi } from 'vitest';

import { createTokenServiceMock } from './token-service-mock';

describe('createTokenServiceMock', () => {
  it('converts function exports into vi.fn() returning undefined', async () => {
    const originalFn = (): string => 'original result';
    const fakeImportOriginal = async (): Promise<Record<string, unknown>> => ({
      someFunction: originalFn,
    });

    const mock = await createTokenServiceMock(fakeImportOriginal);

    expect(mock.someFunction).not.toBe(originalFn);
    expect(vi.isMockFunction(mock.someFunction)).toBe(true);
    expect((mock.someFunction as () => unknown)()).toBeUndefined();
  });

  it('keeps real values for class exports and constants', async () => {
    class SomeClass {
      id = 123;
    }
    const SOME_CONSTANT = 'CONST_VALUE';

    const fakeImportOriginal = async (): Promise<Record<string, unknown>> => ({
      SomeClass,
      SOME_CONSTANT,
    });

    const mock = await createTokenServiceMock(fakeImportOriginal);

    expect(mock.SomeClass).toBe(SomeClass);
    expect(mock.SOME_CONSTANT).toBe(SOME_CONSTANT);
  });

  it('ensures overrides win over stubs and allows adding new names not in original', async () => {
    const originalFn = (): string => 'original';
    const fakeImportOriginal = async (): Promise<Record<string, unknown>> => ({
      getAccessToken: originalFn,
    });

    const overrideFn = vi.fn(() => 'custom token');
    const newExportFn = vi.fn();

    const mock = await createTokenServiceMock(fakeImportOriginal, {
      getAccessToken: overrideFn,
      newExtraExport: newExportFn,
    });

    expect(mock.getAccessToken).toBe(overrideFn);
    expect((mock.getAccessToken as () => unknown)()).toBe('custom token');
    expect(mock.newExtraExport).toBe(newExportFn);
  });
});
