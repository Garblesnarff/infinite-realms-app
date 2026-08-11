import { toast } from '@/hooks/use-toast';
import { userDataApi } from '@/services/user-data-api';

export const reportCombatIntentFailure = (encounterId: string, error: unknown): void => {
  const detail = error instanceof Error ? error.message : String(error);
  userDataApi.reportClientFailure(
    'combat_intent_failed',
    undefined,
    `encounter=${encounterId}; ${detail}`,
  );
  toast({
    title: 'Combat action failed',
    description: 'The server could not complete that action. Please try again.',
    variant: 'destructive',
  });
};
