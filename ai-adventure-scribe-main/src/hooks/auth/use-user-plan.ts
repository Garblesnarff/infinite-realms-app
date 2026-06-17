import { useState, useCallback, useEffect } from 'react';

import logger from '@/lib/logger';
import { isOffline } from '@/utils/network';

export type UserPlan = 'free' | 'pro' | 'enterprise';

interface UseUserPlanProps {
  user: { id: string; email: string } | null;
  loading: boolean;
}

/**
 * Hook to manage user plan state and fetching.
 * Extracted from AuthContext.
 */
export function useUserPlan({ user, loading }: UseUserPlanProps): {
  userPlan: UserPlan | null;
  userPlanLoading: boolean;
  refreshUserPlan: () => Promise<void>;
} {
  const [userPlan, setUserPlan] = useState<UserPlan | null>(null);
  const [userPlanLoading, setUserPlanLoading] = useState(false);

  const fetchUserPlan = useCallback(async () => {
    if (!user) {
      setUserPlan(null);
      setUserPlanLoading(false);
      return;
    }

    // Read token fresh from localStorage to avoid stale closure issues
    const freshToken = window.localStorage.getItem('workos_access_token');
    if (!freshToken) {
      setUserPlan(null);
      setUserPlanLoading(false);
      return;
    }

    if (isOffline()) {
      setUserPlanLoading(false);
      return;
    }

    setUserPlanLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vite import.meta.env typing limitation
      const apiUrl = (import.meta as any).env?.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/v1/llm/quota`, {
        headers: {
          Authorization: `Bearer ${freshToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user plan');
      }

      const data = await response.json();
      setUserPlan((data.plan as UserPlan) || 'free');
    } catch (error) {
      logger.warn('Failed to load user plan', error);
      setUserPlan('free'); // Default to free on error
    } finally {
      setUserPlanLoading(false);
    }
  }, [user]);

  // Clear user plan when user logs out
  useEffect(() => {
    if (!user) {
      setUserPlan(null);
      setUserPlanLoading(false);
    }
  }, [user]);

  // Fetch user plan only after auth is fully loaded (not during refresh)
  useEffect(() => {
    // Don't fetch while still loading/refreshing auth - prevents race condition
    // where we might use stale tokens
    if (loading) return;
    if (!user) return;
    fetchUserPlan();
  }, [user, loading, fetchUserPlan]);

  return {
    userPlan,
    userPlanLoading,
    refreshUserPlan: fetchUserPlan,
  };
}
