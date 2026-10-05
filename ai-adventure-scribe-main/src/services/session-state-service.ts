import type { PersistedRollOutcome, SessionStatePayload } from '@/types/session-state';

import { userDataApi } from '@/services/user-data-api';
import { createDefaultSessionState } from '@/types/session-state';

/**
 * SessionStateService
 * Minimal persistence layer for session state backed by Supabase `game_sessions.session_state` JSONB.
 * Fails safe: returns defaults when the column/table isn't present yet.
 */
export class SessionStateService {
  /** Load state snapshot for a session. */
  static async getState(sessionId: string): Promise<SessionStatePayload> {
    try {
      const data = await userDataApi.getSession(sessionId);
      if (!data) {
        // Column may not exist yet or row missing; return default
        return createDefaultSessionState(sessionId);
      }

      const payload: SessionStatePayload | null = (data as any).session_state || null;
      if (!payload) return createDefaultSessionState(sessionId);

      return payload;
    } catch {
      return createDefaultSessionState(sessionId);
    }
  }

  /** Merge-update the session state JSON and persist. */
  static async updateState(
    sessionId: string,
    partial: Partial<SessionStatePayload>,
  ): Promise<SessionStatePayload> {
    try {
      const current = await this.getState(sessionId);
      const next: SessionStatePayload = {
        ...current,
        ...partial,
        lastUpdate: new Date().toISOString(),
      };

      try {
        await userDataApi.updateSession(sessionId, { session_state: next });
      } catch {
        // If update fails (e.g., column absent), just return the merged snapshot
        return next;
      }
      return next;
    } catch {
      const current = await this.getState(sessionId);
      return {
        ...current,
        ...partial,
        lastUpdate: new Date().toISOString(),
      } as SessionStatePayload;
    }
  }

  /** Append a combat log entry into the state JSON with retention cap. */
  static async appendCombatLog(
    sessionId: string,
    entry: any,
    maxEntries: number = 500,
  ): Promise<void> {
    const current = await this.getState(sessionId);
    const newEntry = { timestamp: new Date().toISOString(), entry };
    const existing = current.combatLog || [];
    const merged = [...existing, newEntry];
    const trimmed = merged.length > maxEntries ? merged.slice(merged.length - maxEntries) : merged;

    const updated: SessionStatePayload = {
      ...current,
      combatLog: trimmed,
      lastUpdate: new Date().toISOString(),
    };

    try {
      await userDataApi.updateSession(sessionId, { session_state: updated });
    } catch {
      // safe failure
    }
  }

  /** Convenience: append a structured dice/roll event to the combat log. */
  static async appendRollEvent(
    sessionId: string,
    event: { kind: string; payload: any },
  ): Promise<void> {
    await this.appendCombatLog(sessionId, { kind: event.kind, payload: event.payload });
  }

  /** Read the newest persisted roll result that has an authoritative outcome. */
  static async getLatestRollOutcome(sessionId: string): Promise<PersistedRollOutcome | null> {
    const state = await this.getState(sessionId);
    const entries = state.combatLog || [];

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const logEntry = entries[index];
      const event = logEntry?.entry;
      if (!event || typeof event !== 'object') continue;

      const candidate = event as { kind?: unknown; payload?: unknown };
      if (candidate.kind !== 'roll_result' || !candidate.payload) continue;
      // Text-parsed roll mentions are logged as roll_result too, with no authoritative
      // outcome of their own ({ total, raw } and no success flag). They are the one
      // skippable shape: a typed "I rolled 17" must not shadow the real roll below it.
      // Any other entry without an authoritative outcome is a real roll that simply has
      // no DC/AC verdict (an untargeted check, a damage roll) — stop there instead of
      // surfacing an older roll from an earlier turn as the latest outcome.
      if (typeof candidate.payload !== 'object') continue;

      const payload = candidate.payload as Record<string, unknown>;
      if (typeof payload.success !== 'boolean' || typeof payload.total !== 'number') {
        if (typeof payload.raw === 'string') continue;
        return null;
      }

      return {
        success: payload.success,
        total: payload.total,
        dc: typeof payload.dc === 'number' ? payload.dc : undefined,
        ac: typeof payload.ac === 'number' ? payload.ac : undefined,
        requestType: typeof payload.requestType === 'string' ? payload.requestType : undefined,
        description: typeof payload.description === 'string' ? payload.description : undefined,
        timestamp: logEntry.timestamp,
      };
    }

    return null;
  }
}

export const sessionStateService = SessionStateService;
