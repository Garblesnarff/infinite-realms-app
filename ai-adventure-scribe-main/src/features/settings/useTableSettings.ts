import { useState } from 'react';

import {
  DEFAULT_TABLE_SETTINGS,
  readTableSettings,
  writeTableSettings,
  type TableSettings,
} from './table-settings';

import { useAuth } from '@/contexts/AuthContext';

/** Settings for the signed-in user. Without a user, the defaults apply and nothing is saved. */
export const useTableSettings = (): {
  settings: TableSettings;
  updateSettings: (patch: Partial<TableSettings>) => void;
} => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [settings, setSettings] = useState<TableSettings>(() =>
    userId ? readTableSettings(userId) : { ...DEFAULT_TABLE_SETTINGS },
  );

  const updateSettings = (patch: Partial<TableSettings>): void => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (userId) writeTableSettings(userId, next);
  };

  return { settings, updateSettings };
};
