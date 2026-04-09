/**
 * Combat Route Helpers
 * Shared utilities for combat route handlers
 * Extracted to reduce code duplication across combat endpoints
 *
 * Ported from /server/src/routes/v1/combat-helpers.ts
 */

import { supabaseService } from './supabase.js';
import { CombatEncounterService } from '../services/combat/combat-encounter-service.js';

/**
 * Result of verifying encounter ownership
 */
export interface EncounterVerificationResult {
  success: boolean;
  encounter?: any;
  session?: any;
  error?: {
    status: number;
    message: string;
  };
}

/**
 * Verify that the user owns the encounter's session
 * Checks both campaign ownership and character ownership
 *
 * @param encounterId - The combat encounter ID
 * @param userId - The authenticated user's ID
 * @returns Verification result with encounter/session data or error info
 */
export async function verifyEncounterOwnership(
  encounterId: string | undefined,
  userId: string
): Promise<EncounterVerificationResult> {
  // Validate encounterId
  if (!encounterId) {
    return {
      success: false,
      error: { status: 400, message: 'encounterId is required' },
    };
  }

  // Get encounter
  const encounter = await CombatEncounterService.getEncounterById(encounterId, userId);
  if (!encounter) {
    return {
      success: false,
      error: { status: 404, message: 'Encounter not found' },
    };
  }

  // Get session and verify ownership
  const { data: session, error: sessionErr } = await supabaseService
    .from('game_sessions')
    .select('*, campaigns!game_sessions_campaign_id_fkey(user_id), characters!game_sessions_character_id_fkey(user_id, owner_id)')
    .eq('id', encounter.sessionId)
    .single();

  if (sessionErr || !session) {
    return {
      success: false,
      error: { status: 404, message: 'Session not found' },
    };
  }

  // Verify ownership - user must own either campaign or character
  const campaignOwner = (session as any).campaigns?.user_id;
  const characterOwner = (session as any).characters?.user_id;
  const characterSharedOwner = (session as any).characters?.owner_id;

  if (campaignOwner !== userId && characterOwner !== userId && characterSharedOwner !== userId) {
    return {
      success: false,
      error: { status: 404, message: 'Encounter not found' },
    };
  }

  return {
    success: true,
    encounter,
    session,
  };
}

/**
 * Verify session ownership for starting combat
 *
 * @param sessionId - The game session ID
 * @param userId - The authenticated user's ID
 * @returns Verification result with session data or error info
 */
export async function verifySessionOwnership(
  sessionId: string | undefined,
  userId: string
): Promise<{ success: boolean; session?: any; error?: { status: number; message: string } }> {
  if (!sessionId) {
    return {
      success: false,
      error: { status: 400, message: 'sessionId is required' },
    };
  }

  const { data: session, error: sessionErr } = await supabaseService
    .from('game_sessions')
    .select('*, campaigns!game_sessions_campaign_id_fkey(user_id), characters!game_sessions_character_id_fkey(user_id, owner_id)')
    .eq('id', sessionId)
    .single();

  if (sessionErr || !session) {
    return {
      success: false,
      error: { status: 404, message: 'Session not found' },
    };
  }

  const campaignOwner = (session as any).campaigns?.user_id;
  const characterOwner = (session as any).characters?.user_id;
  const characterSharedOwner = (session as any).characters?.owner_id;

  if (campaignOwner !== userId && characterOwner !== userId && characterSharedOwner !== userId) {
    return {
      success: false,
      error: { status: 404, message: 'Session not found' },
    };
  }

  return { success: true, session };
}
