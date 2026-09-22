import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

export type CampaignListRow = Awaited<ReturnType<typeof userDataApi.listCampaigns>>[number];

/** Navigating between screens within this window reuses the cached list. */
export const CAMPAIGNS_LIST_STALE_TIME_MS = 60_000;

/**
 * One cache entry per user for `GET /v1/campaigns`. Screens that need a
 * filtered or sorted view derive it with `select` so every consumer shares
 * this key — a key that varies per character or per keystroke turns each
 * mount into a fresh request (#2149).
 */
export function campaignsListQueryKey(
  userId: string | undefined,
): readonly ['campaigns', string | undefined] {
  return ['campaigns', userId] as const;
}

function isRateLimited(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 429;
}

interface UseCampaignsListOptions<TData> {
  /** Defer the request until the consumer is visible (e.g. a closed modal). */
  enabled?: boolean;
  select?: (campaigns: CampaignListRow[]) => TData;
}

export function useCampaignsList<TData = CampaignListRow[]>({
  enabled = true,
  select,
}: UseCampaignsListOptions<TData> = {}): UseQueryResult<TData> {
  const { user } = useAuth();

  return useQuery({
    queryKey: campaignsListQueryKey(user?.id),
    queryFn: async () => {
      try {
        return await userDataApi.listCampaigns();
      } catch (err) {
        logger.error('Error fetching campaigns:', err);
        throw err;
      }
    },
    select,
    enabled: enabled && Boolean(user?.id),
    staleTime: CAMPAIGNS_LIST_STALE_TIME_MS,
    // Retrying into a 429 only deepens the rate limit; the retry UI hands the
    // next attempt to the player.
    retry: (failureCount, error) => !isRateLimited(error) && failureCount < 1,
  });
}
