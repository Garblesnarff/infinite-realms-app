import { DEFAULT_TABLE_SETTINGS, readTableSettings } from './table-settings';

import { useOptionalAuth } from '@/contexts/AuthContext';

/**
 * Whether the signed-in user's Table > Dice sound setting is on.
 * Sound is on when no user is signed in or the component has no AuthProvider.
 */
export const useDiceSoundEnabled = (): boolean => {
  const userId = useOptionalAuth()?.user?.id ?? null;
  return userId ? readTableSettings(userId).diceSound : DEFAULT_TABLE_SETTINGS.diceSound;
};
