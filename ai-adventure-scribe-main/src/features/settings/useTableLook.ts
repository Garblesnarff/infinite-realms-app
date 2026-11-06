import { useEffect } from 'react';

import { DEFAULT_TABLE_SETTINGS, readTableSettings } from './table-settings';

import { useOptionalAuth } from '@/contexts/AuthContext';

/** Apply the per-user choice to every route that uses Table materials. */
export const useTableLook = (): void => {
  const userId = useOptionalAuth()?.user?.id ?? null;
  useEffect(() => {
    const apply = (): void => {
      const enabled = userId
        ? readTableSettings(userId).tableLook
        : DEFAULT_TABLE_SETTINGS.tableLook;
      document.body.classList.toggle('ir-table-look', enabled);
    };
    apply();
    window.addEventListener('ir-table-settings', apply);
    window.addEventListener('storage', apply);
    return () => {
      window.removeEventListener('ir-table-settings', apply);
      window.removeEventListener('storage', apply);
      document.body.classList.remove('ir-table-look');
    };
  }, [userId]);
};
