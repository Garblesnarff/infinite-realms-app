import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from './use-toast';

import { APP_BUILD_VERSION, extractServedAppVersion } from '@/services/app-version';
import { userDataApi } from '@/services/user-data-api';

export const DEFAULT_STALE_CLIENT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface UseStaleClientCheckOptions {
  isInCombat: boolean;
  sessionId?: string | null;
  intervalMs?: number;
}

export interface StaleClientCheckResult {
  isStale: boolean;
  staleVersion: string | null;
  checkNow: () => Promise<void>;
}

/**
 * Checks the no-cache HTML entry point so a long-lived SPA tab can notice a new bundle
 * without requiring a route change. The notification is deliberately deferred while
 * combat is active, because refreshing is disruptive and can discard an in-progress turn.
 */
export function useStaleClientCheck({
  isInCombat,
  sessionId,
  intervalMs = DEFAULT_STALE_CLIENT_CHECK_INTERVAL_MS,
}: UseStaleClientCheckOptions): StaleClientCheckResult {
  const { toast, dismiss } = useToast();
  const [staleVersion, setStaleVersion] = useState<string | null>(null);
  const isInCombatRef = useRef(isInCombat);
  const pendingVersionRef = useRef<string | null>(null);
  const reportedVersionRef = useRef<string | null>(null);
  const toastIdRef = useRef<string | null>(null);
  const checkInFlightRef = useRef(false);

  const showPendingToast = useCallback(() => {
    const pendingVersion = pendingVersionRef.current;
    if (!pendingVersion || isInCombatRef.current || toastIdRef.current) return;

    toastIdRef.current = toast({
      title: 'New version available',
      description: 'Refresh to load the latest version.',
      action: {
        label: 'Refresh',
        onClick: () => window.location.reload(),
      },
      duration: Infinity,
    }).id;
  }, [toast]);

  const checkNow = useCallback(async () => {
    if (checkInFlightRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    checkInFlightRef.current = true;
    try {
      const response = await fetch('/index.html', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
      });
      if (!response.ok) return;

      const servedVersion = extractServedAppVersion(await response.text());
      if (!servedVersion || servedVersion === APP_BUILD_VERSION) return;

      pendingVersionRef.current = servedVersion;
      setStaleVersion(servedVersion);

      if (reportedVersionRef.current !== servedVersion) {
        reportedVersionRef.current = servedVersion;
        userDataApi.reportClientFailure(
          'stale_client_detected',
          sessionId || undefined,
          `running=${APP_BUILD_VERSION}; served=${servedVersion}`,
        );
      }

      showPendingToast();
    } catch {
      // A failed version check should never interrupt the current game session.
    } finally {
      checkInFlightRef.current = false;
    }
  }, [sessionId, showPendingToast]);

  useEffect(() => {
    isInCombatRef.current = isInCombat;
  }, [isInCombat]);

  useEffect(() => {
    if (isInCombat) {
      if (toastIdRef.current) {
        dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    showPendingToast();
  }, [dismiss, isInCombat, showPendingToast]);

  useEffect(() => {
    const checkOnFocus = (): void => {
      void checkNow();
    };
    const checkOnVisibility = (): void => {
      if (document.visibilityState === 'visible') void checkNow();
    };

    window.addEventListener('focus', checkOnFocus);
    document.addEventListener('visibilitychange', checkOnVisibility);
    const intervalId = window.setInterval(() => void checkNow(), intervalMs);
    void checkNow();

    return () => {
      window.removeEventListener('focus', checkOnFocus);
      document.removeEventListener('visibilitychange', checkOnVisibility);
      window.clearInterval(intervalId);
      if (toastIdRef.current) {
        dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
    };
  }, [checkNow, dismiss, intervalMs]);

  return {
    isStale: staleVersion !== null,
    staleVersion,
    checkNow,
  };
}
