import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

interface SessionValidatorProps {
  sessionId: string | null;
  campaignId: string | null;
  characterId: string | null;
}

/**
 * Custom hook for validating game session data
 * @param sessionId - Current session ID
 * @param campaignId - Current campaign ID
 * @param characterId - Current character ID
 * @returns Boolean indicating if session is valid
 */
export const useSessionValidator = ({
  sessionId,
  campaignId,
  characterId,
}: SessionValidatorProps) => {
  const { toast } = useToast();

  const validateSession = async () => {
    if (!sessionId || !campaignId || !characterId) {
      logger.error('Missing required IDs:', { sessionId, campaignId, characterId });
      toast({
        title: 'Session Error',
        description: 'Missing required session information',
        variant: 'destructive',
      });
      return false;
    }

    // Verify session exists with required data
    // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
    try {
      const session = await userDataApi.getSession(sessionId);
      if (session.campaign_id !== campaignId || session.character_id !== characterId)
        throw new Error('Session mismatch');
    } catch (error) {
      logger.error('Session validation failed:', error);
      toast({
        title: 'Session Error',
        description: 'Invalid game session. Please try starting a new game.',
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  return validateSession;
};
