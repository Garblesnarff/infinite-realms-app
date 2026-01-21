import { CombatInitiativeService } from '../../../services/combat-initiative-service.js';
import { supabaseService } from '../../../lib/supabase.js';

export interface VerificationResult {
  success: boolean;
  encounter?: any;
  session?: any;
  error?: { status: number; message: string };
}

/**
 * Verify that the user owns the encounter's session
 */
export async function verifyEncounterOwnership(
  encounterId: string | undefined,
  userId: string
): Promise<VerificationResult> {
  if (!encounterId) {
    return { success: false, error: { status: 400, message: 'encounterId is required' } };
  }

  const encounter = await CombatInitiativeService.getEncounterById(encounterId);
  if (!encounter) {
    return { success: false, error: { status: 404, message: 'Encounter not found' } };
  }

  const { data: session, error: sessionErr } = await supabaseService
    .from('game_sessions')
    .select('*, campaigns!game_sessions_campaign_id_fkey(user_id), characters!game_sessions_character_id_fkey(user_id)')
    .eq('id', encounter.sessionId)
    .single();

  if (sessionErr || !session) {
    return { success: false, error: { status: 404, message: 'Session not found' } };
  }

  const campaignOwner = (session as any).campaigns?.user_id;
  const characterOwner = (session as any).characters?.user_id;

  if (campaignOwner !== userId && characterOwner !== userId) {
    return { success: false, error: { status: 403, message: 'Access denied' } };
  }

  return { success: true, encounter, session };
}

/**
 * Verify session ownership for starting combat
 */
export async function verifySessionOwnership(
  sessionId: string | undefined,
  userId: string
): Promise<VerificationResult> {
  if (!sessionId) {
    return { success: false, error: { status: 400, message: 'sessionId is required' } };
  }

  const { data: session, error: sessionErr } = await supabaseService
    .from('game_sessions')
    .select('*, campaigns!game_sessions_campaign_id_fkey(user_id), characters!game_sessions_character_id_fkey(user_id)')
    .eq('id', sessionId)
    .single();

  if (sessionErr || !session) {
    return { success: false, error: { status: 404, message: 'Session not found' } };
  }

  const campaignOwner = (session as any).campaigns?.user_id;
  const characterOwner = (session as any).characters?.user_id;

  if (campaignOwner !== userId && characterOwner !== userId) {
    return { success: false, error: { status: 403, message: 'Access denied' } };
  }

  return { success: true, session };
}
