import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { userDataApi } from '@/services/user-data-api';

export function useCampaignJournal(sessionId: string | null | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: ['campaign-journal', sessionId] });
    window.addEventListener('campaign-journal-updated', refresh);
    return () => window.removeEventListener('campaign-journal-updated', refresh);
  }, [queryClient, sessionId]);
  return useQuery({
    queryKey: ['campaign-journal', sessionId],
    queryFn: () => userDataApi.getSessionJournal(sessionId!),
    enabled: Boolean(sessionId),
  });
}
