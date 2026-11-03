import { useEffect } from 'react';

import { applyReduceMotion } from './reduce-motion';
import { readTableSettings } from './table-settings';

import { useOptionalAuth } from '@/contexts/AuthContext';

/**
 * Keeps the document override in step with this user's saved Reduce motion choice.
 * Safe without an auth provider: nothing is forced, and the system preference stands.
 */
export const useApplyReduceMotion = (): void => {
  const userId = useOptionalAuth()?.user?.id ?? null;

  useEffect(() => {
    const apply = (): void => {
      applyReduceMotion(userId ? readTableSettings(userId).reduceMotion : 'system');
    };
    apply();
    window.addEventListener('ir-table-settings', apply);
    window.addEventListener('storage', apply);
    return () => {
      window.removeEventListener('ir-table-settings', apply);
      window.removeEventListener('storage', apply);
    };
  }, [userId]);
};
