import type {
  CreateSessionRequest,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  SharedSession,
  JoinSessionRequest,
  TurnState,
  ParticipantPermissions,
} from './types';
import type { PlayerIntent } from '../scene/types';

/**
 * Generates a unique ID for session entities
 */
export function generateId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generates a unique 6-character session code
 */
export function generateSessionCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Validates a session creation request
 */
export function validateSessionRequest(request: CreateSessionRequest): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!request.name || request.name.trim().length < 3) {
    errors.push({
      field: 'name',
      message: 'Session name must be at least 3 characters long',
      severity: 'error',
      code: 'NAME_TOO_SHORT',
    });
  }

  if (request.name && request.name.length > 100) {
    errors.push({
      field: 'name',
      message: 'Session name cannot exceed 100 characters',
      severity: 'error',
      code: 'NAME_TOO_LONG',
    });
  }

  if (request.description && request.description.length > 500) {
    warnings.push({
      field: 'description',
      message: 'Description is quite long, consider shortening it',
      suggestion: 'Keep description under 300 characters for better readability',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    recommendations: [],
  };
}

/**
 * Validates a request to join a session
 */
export function validateJoinRequest(
  session: SharedSession,
  request: JoinSessionRequest,
  userId: string,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!request.displayName || request.displayName.trim().length < 2) {
    errors.push({
      field: 'displayName',
      message: 'Display name must be at least 2 characters long',
      severity: 'error',
    });
  }

  if (session.currentPlayers >= session.maxPlayers) {
    errors.push({
      field: 'session',
      message: 'Session is full',
      severity: 'error',
    });
  }

  // Check if user already in session
  const existingParticipant = session.participants.find((p) => p.userId === userId);
  if (existingParticipant) {
    errors.push({
      field: 'user',
      message: 'User already joined this session',
      severity: 'error',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    recommendations: [],
  };
}

/**
 * Extracts a display name from a user ID (placeholder implementation)
 */
export function extractDisplayNameFromUser(userId: string): string {
  // In a real implementation, this would query the user's profile
  return `User-${userId.substr(0, 8)}`;
}

/**
 * Gets default permissions based on a participant's role
 */
export function getDefaultPermissions(role: 'player' | 'dm' | 'spectator'): ParticipantPermissions {
  const basePermissions = {
    canControlEntities: false,
    canWorldBuild: false,
    canInvitePlayers: false,
    canModerateChat: false,
    canPauseGame: false,
    canEndSession: false,
    canResolveConflicts: false,
  };

  if (role === 'player') {
    return {
      ...basePermissions,
      canControlEntities: true,
      canInvitePlayers: true,
    };
  }

  if (role === 'dm') {
    return {
      ...basePermissions,
      canControlEntities: true,
      canWorldBuild: true,
      canInvitePlayers: true,
      canModerateChat: true,
      canPauseGame: true,
      canEndSession: true,
      canResolveConflicts: true,
    };
  }

  return basePermissions; // spectator
}

/**
 * Infers the turn type based on the player's intent content
 */
export function inferTurnType(action: PlayerIntent): TurnState['turnType'] {
  // Simple inference based on action content
  const content = action.content?.toLowerCase() || '';

  if (content.includes('attack') || content.includes('fight') || content.includes('cast')) {
    return 'combat';
  }
  if (content.includes('move') || content.includes('go') || content.includes('walk')) {
    return 'movement';
  }
  if (content.includes('talk') || content.includes('say') || content.includes('ask')) {
    return 'dialogue';
  }
  if (content.includes('rest') || content.includes('sleep') || content.includes('camp')) {
    return 'rest';
  }

  return 'action';
}
