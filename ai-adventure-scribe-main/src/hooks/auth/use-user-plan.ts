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
 * Backoff for the plan refetch after a failed fetch (#351): 1s, 2s, 4s…
 * capped at 30s. A reload that hits a blip (or a tester on a flaky network)
 * must not sit on a wrong "Free Tier" label forever, but it also must not
 * hammer the quota endpoint.
 */
const PLAN_RETRY_BASE_MS = 1000;
const PLAN_RETRY_MAX_MS = 30_000;

const retryDelayMs = (attempt: number): number =>
  Math.min(PLAN_RETRY_BASE_MS * 2 ** attempt, PLAN_RETRY_MAX_MS);

/**
 * Hook to manage user plan state and fetching.
 * Extracted from AuthContext.
 *
 * #351: a failed fetch never downgrades the plan. The last known plan stays
 * rendered; when there is none, the UI shows "Plan unavailable — retry"
 * instead of "Free Tier", and the fetch retries with backoff.
 */
export function useUserPlan({ user, loading }: UseUserPlanProps): {
  userPlan: UserPlan | null;
  userPlanLoading: boolean;
  userPlanError: boolean;
  refreshUserPlan: () => Promise<void>;
} {
  const [userPlan, setUserPlan] = useState<UserPlan | null>(null);
  const [userPlanLoading, setUserPlanLoading] = useState(false);
  const [userPlanError, setUserPlanError] = useState(false);
  // The account the current plan belongs to. A response that lands after
  // sign-out or an account switch must not paint the old account's plan.
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const fetchUserPlan = useCallback(async () => {
    if (!user) {
      clearPendingRetry();
      setUserPlan(null);
      setUserPlanLoading(false);
      return;
    }

    // Not being able to reach the server is a fetch failure (#351): it must
    // never paint "Free Tier". Keep the last known plan (if any), surface the
    // retry state, and try again with backoff — the token may appear after an
    // auth refresh and the network may come back.
    const fail = (message: string, detail?: unknown): void => {
      logger.warn(message, detail);
      setUserPlanError(true);
      setUserPlanLoading(false);
      clearPendingRetry();
      const delay = retryDelayMs(retryAttemptRef.current);
      retryAttemptRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        void fetchUserPlan();
      }, delay);
    };

    // Read the current token fresh to avoid stale closure issues.
    const freshToken = getAccessToken();
    if (!freshToken) {
      fail('Cannot load user plan: no access token');
      return;
    }

    if (isOffline()) {
      fail('Cannot load user plan: offline');
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
      clearPendingRetry();
      retryAttemptRef.current = 0;
      setUserPlanError(false);
      setUserPlan((data.plan as UserPlan) || 'free');
    } catch (error) {
      if (userIdRef.current !== requestedFor) return;
      // #351: never downgrade the label on a client error. Keep the last
      // known plan; when there is none the UI shows "Plan unavailable —
      // retry". Retry with backoff.
      fail('Failed to load user plan', error);
    } finally {
      if (userIdRef.current === requestedFor) setUserPlanLoading(false);
    }
  }, [user, clearPendingRetry]);

  // Clear user plan when user logs out or a different account signs in, so
  // the previous account's plan never shows while the new one loads.
  const userId = user?.id ?? null;
  useEffect(() => {
    clearPendingRetry();
    retryAttemptRef.current = 0;
    setUserPlan(null);
    setUserPlanError(false);
    setUserPlanLoading(false);
  }, [userId, clearPendingRetry]);

  // A retry must never fire after unmount.
  useEffect(() => clearPendingRetry, [clearPendingRetry]);

  // Fetch user plan only after auth is fully loaded (not during refresh)
  useEffect(() => {
    // Don't fetch while still loading/refreshing auth - prevents race condition
    // where we might use stale tokens
    if (loading) return;
    if (!user) return;
    fetchUserPlan();
  }, [user, loading, fetchUserPlan]);

  const refreshUserPlan = useCallback(async () => {
    clearPendingRetry();
    retryAttemptRef.current = 0;
    await fetchUserPlan();
  }, [clearPendingRetry, fetchUserPlan]);

  return useMemo(
    () => ({
      userPlan,
      userPlanLoading,
      userPlanError,
      refreshUserPlan,
    }),
    [userPlan, userPlanLoading, userPlanError, refreshUserPlan],
  );
}
