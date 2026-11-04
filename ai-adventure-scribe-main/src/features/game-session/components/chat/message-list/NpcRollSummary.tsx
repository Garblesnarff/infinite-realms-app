import React, { useMemo } from 'react';

import { formatNarrative } from './formatNarrative';

import type { AutoRollResult } from '@/services/combat/npc-auto-roller';

import { formatNPCRollsSystemMessage } from '@/services/ai/npc-roll-handler';

/**
 * The Behind the Screen summary for one DM message's auto-executed NPC rolls
 * (#1347 last item). The rolls arrive on the live DM message's context
 * (use-ai-response attaches context.npcRollResults); nothing is rendered when
 * the message carries none. Entries are shape-checked at render, like the
 * story-tracker line: a malformed entry drops out rather than printing a
 * half line or throwing inside the formatter.
 */
export const NpcRollSummary: React.FC<{ rolls: unknown }> = ({ rolls }) => {
  const summary = useMemo(() => {
    if (!Array.isArray(rolls)) return '';
    const valid = rolls.filter((entry): entry is AutoRollResult => {
      if (!entry || typeof entry !== 'object') return false;
      const request = (entry as { request?: unknown }).request;
      const result = (entry as { result?: unknown }).result;
      if (!request || typeof request !== 'object') return false;
      if (!result || typeof result !== 'object') return false;
      if (typeof (request as { purpose?: unknown }).purpose !== 'string') return false;
      if ((request as { purpose: string }).purpose.trim().length === 0) return false;
      return Number.isFinite((result as { total?: unknown }).total);
    });
    if (valid.length === 0) return '';
    return formatNPCRollsSystemMessage(valid);
  }, [rolls]);

  const { content } = formatNarrative(summary);
  if (!content) return null;

  return (
    <div
      data-testid="npc-roll-summary"
      aria-label="Behind the screen"
      className="mt-3 border-t border-white/10 pt-3 text-sm text-white/70"
    >
      {content}
    </div>
  );
};
