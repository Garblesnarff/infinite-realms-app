import { logger } from '../lib/logger';

import { supabase } from '@/integrations/supabase/client';

export type RollKind = 'check' | 'save' | 'attack' | 'initiative' | 'damage';

export interface RollRequestEntry {
  sessionId: string;
  kind: RollKind;
  purpose?: string;
  formula?: string;
  dc?: number;
  ac?: number;
  advantage?: boolean;
  disadvantage?: boolean;
  meta?: Record<string, unknown>;
}

export interface RollResultEntry {
  sessionId: string;
  kind: RollKind;
  resultTotal: number;
  resultNatural?: number;
  dc?: number;
  ac?: number;
  success?: boolean;
  meta?: Record<string, unknown>;
}

/** Shape of a row inserted into the roll_history Supabase table. */
interface RollHistoryInsert {
  session_id: string;
  kind: RollKind;
  purpose?: string | null;
  formula?: string | null;
  dc?: number | null;
  ac?: number | null;
  advantage?: boolean | null;
  disadvantage?: boolean | null;
  result_total?: number | null;
  result_natural?: number | null;
  success?: boolean | null;
  meta: Record<string, unknown>;
}

/** Shape of a row returned from the roll_history Supabase table. */
interface RollHistoryRow {
  id: string;
  session_id: string;
  created_at: string;
  kind: string;
  purpose: string | null;
  formula: string | null;
  dc: number | null;
  ac: number | null;
  result_total: number | null;
  result_natural: number | null;
  advantage: boolean | null;
  disadvantage: boolean | null;
  success: boolean | null;
  meta: Record<string, unknown>;
}

/** #493: roll_history not in generated Database types yet */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- table missing from Database; see #493
function rollHistoryFrom(): any {
  // @ts-expect-error #493 roll_history missing from generated Database types
  return supabase.from('roll_history');
}

function flagEnabled(): boolean {
  try {
    const v = String(import.meta.env.VITE_ENABLE_ROLL_HISTORY ?? 'false').toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(v);
  } catch {
    return false;
  }
}

async function safePrune(sessionId: string, cap = 500) {
  try {
    const { data: ids } = await rollHistoryFrom()
      .select('id')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .range(cap, 100000);

    const toDelete = (ids || []).map((r: { id: string }) => r.id);
    if (toDelete.length > 0) {
      await rollHistoryFrom().delete().in('id', toDelete);
    }
  } catch (e) {
    // Fail-safe: table may not exist or permission error; ignore
    logger.warn('[RollManager] prune skipped:', e);
  }
}

export const RollManager = {
  async recordRollRequest(e: RollRequestEntry) {
    if (!flagEnabled()) return;
    try {
      const payload: RollHistoryInsert = {
        session_id: e.sessionId,
        kind: e.kind,
        purpose: e.purpose ?? null,
        formula: e.formula ?? null,
        dc: e.dc ?? null,
        ac: e.ac ?? null,
        advantage: e.advantage ?? null,
        disadvantage: e.disadvantage ?? null,
        meta: e.meta ?? {},
      };
      await rollHistoryFrom().insert(payload);
      await safePrune(e.sessionId);
    } catch (err) {
      logger.warn('[RollManager] recordRollRequest failed (non-fatal):', err);
    }
  },

  async recordRollResult(e: RollResultEntry) {
    if (!flagEnabled()) return;
    try {
      const payload: RollHistoryInsert = {
        session_id: e.sessionId,
        kind: e.kind,
        result_total: e.resultTotal,
        result_natural: e.resultNatural ?? null,
        dc: e.dc ?? null,
        ac: e.ac ?? null,
        success: e.success ?? null,
        meta: e.meta ?? {},
      };
      await rollHistoryFrom().insert(payload);
      await safePrune(e.sessionId);
    } catch (err) {
      logger.warn('[RollManager] recordRollResult failed (non-fatal):', err);
    }
  },

  async getRecentRolls(sessionId: string, limit = 50) {
    if (!flagEnabled()) return [] as RollHistoryRow[];
    try {
      /**
       * ⚡ Bolt: Using explicit column list to avoid fetching the potentially large
       * 'meta' JSONB field for every row unless specifically needed.
       */
      const ROLL_COLS =
        'id, session_id, created_at, kind, purpose, formula, dc, ac, result_total, result_natural, advantage, disadvantage, success';
      const { data, error } = await rollHistoryFrom()
        .select(ROLL_COLS)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as unknown as RollHistoryRow[];
    } catch (err) {
      logger.warn('[RollManager] getRecentRolls failed (non-fatal):', err);
      return [] as RollHistoryRow[];
    }
  },
};
