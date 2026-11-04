import { useEffect, useState } from 'react';

import { DEFAULT_TABLE_SETTINGS, readTableSettings } from './table-settings';

import { useOptionalAuth } from '@/contexts/AuthContext';

/**
 * Whether the signed-in user's Table > Show NPC Rolls setting is on.
 * Re-reads when table settings are written (the `ir-table-settings` event
 * writeTableSettings dispatches) or change in another tab, so toggling the
 * switch shows or hides summaries already in chat without a reload.
 * Safe without an auth provider: the default (on) applies.
 */
export const useShowNPCRolls = (): boolean => {
  const userId = useOptionalAuth()?.user?.id ?? null;
  const [show, setShow] = useState<boolean>(() =>
    userId ? readTableSettings(userId).showNPCRolls : DEFAULT_TABLE_SETTINGS.showNPCRolls,
  );

  useEffect(() => {
    const refresh = (): void => {
      setShow(
        userId ? readTableSettings(userId).showNPCRolls : DEFAULT_TABLE_SETTINGS.showNPCRolls,
      );
    };
    refresh();
    window.addEventListener('ir-table-settings', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('ir-table-settings', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [userId]);

  return show;
};
