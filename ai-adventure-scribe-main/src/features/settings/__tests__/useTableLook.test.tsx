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

  it('defaults on and updates without a reload when the setting changes', () => {
    const { unmount } = renderHook(() => useTableLook());
    expect(document.body).toHaveClass('ir-table-look');
    act(() => {
      writeTableSettings('table-user', { ...DEFAULT_TABLE_SETTINGS, tableLook: false });
    });
    expect(document.body).not.toHaveClass('ir-table-look');
    act(() => {
      writeTableSettings('table-user', { ...DEFAULT_TABLE_SETTINGS, tableLook: true });
    });
    expect(document.body).toHaveClass('ir-table-look');
    unmount();
    expect(document.body).not.toHaveClass('ir-table-look');
  });
});
