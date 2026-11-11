import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_TABLE_SETTINGS, writeTableSettings } from '../table-settings';
import { useTableLook } from '../useTableLook';

vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ user: { id: 'table-user' } }),
}));

describe('Table look', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => document.body.classList.remove('ir-table-look'));

  it('is always on, even when an old saved choice says off', () => {
    writeTableSettings('table-user', { ...DEFAULT_TABLE_SETTINGS, tableLook: false });
    const { unmount } = renderHook(() => useTableLook());
    expect(document.body).toHaveClass('ir-table-look');
    act(() => {
      window.dispatchEvent(new Event('ir-table-settings'));
    });
    expect(document.body).toHaveClass('ir-table-look');
    unmount();
    expect(document.body).not.toHaveClass('ir-table-look');
  });
});
