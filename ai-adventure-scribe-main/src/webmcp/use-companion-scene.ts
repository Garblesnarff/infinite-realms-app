import { useQuery } from '@tanstack/react-query';

import { getCompanionScene } from './companion-api';

import type { CompanionSceneResponse } from './companion-api';

export const companionSceneQueryKey = (sessionId: string) =>
  ['companion-scene', sessionId] as const;

export const useCompanionScene = (sessionId: string | null | undefined) =>
  useQuery<CompanionSceneResponse>({
    queryKey: sessionId ? companionSceneQueryKey(sessionId) : ['companion-scene', null],
    queryFn: () => getCompanionScene(sessionId as string),
    enabled: Boolean(sessionId),
    retry: false,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
