import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import type { UserPlan } from '../../../shared/plan-features';

import logger from '@/lib/logger';
import { getAccessToken } from '@/services/auth/TokenService';
import { isOffline } from '@/utils/network';

export type { UserPlan };

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
  // The account the current plan belongs to. A response that lands after
  // sign-out or an account switch must not paint the old account's plan.
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;

  const fetchUserPlan = useCallback(async () => {
    if (!user) {
      setUserPlan(null);
      setUserPlanLoading(false);
      return;
    }

    // Read the current token fresh to avoid stale closure issues.
    const freshToken = getAccessToken();
    if (!freshToken) {
      setUserPlan(null);
      setUserPlanLoading(false);
      return;
    }

    if (isOffline()) {
      setUserPlanLoading(false);
      return;
    }

    const requestedFor = user.id;
    setUserPlanLoading(true);
    try {
      const apiUrl = import.meta.env?.VITE_API_URL || '';
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
      if (userIdRef.current !== requestedFor) return;
      setUserPlan((data.plan as UserPlan) || 'free');
    } catch (error) {
      logger.warn('Failed to load user plan', error);
      if (userIdRef.current !== requestedFor) return;
      setUserPlan('free'); // Default to free on error
    } finally {
      if (userIdRef.current === requestedFor) setUserPlanLoading(false);
    }
  }, [user]);

  // Clear user plan when user logs out or a different account signs in, so
  // the previous account's plan never shows while the new one loads.
  const userId = user?.id ?? null;
  useEffect(() => {
    setUserPlan(null);
    setUserPlanLoading(false);
  }, [userId]);

  // Fetch user plan only after auth is fully loaded (not during refresh)
  useEffect(() => {
    // Don't fetch while still loading/refreshing auth - prevents race condition
    // where we might use stale tokens
    if (loading) return;
    if (!user) return;
    fetchUserPlan();
  }, [user, loading, fetchUserPlan]);

  return useMemo(
    () => ({
      userPlan,
      userPlanLoading,
      refreshUserPlan: fetchUserPlan,
    }),
    [userPlan, userPlanLoading, fetchUserPlan],
  );
}
