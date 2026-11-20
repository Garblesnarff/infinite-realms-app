/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #157 client rows: the Behind the Screen summary is player-visible chat text, so it follows the
 * player's "Show target numbers" setting through `formatNPCRollsSystemMessage`'s second argument.
 * The chat component passes that setting (NpcRollSummary.tsx). Kept in its own file so the
 * existing npc-roll-handler test file is not rewritten.
 */
import { describe, it, expect, vi } from 'vitest';

import { formatNPCRollsSystemMessage } from '../npc-roll-handler';

vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const TARGET_PATTERN = /vs (AC|DC)\b|\bAC\b|\bDC\b/;

const attackRoll: any = {
  request: { actorName: 'Goblin', purpose: 'scimitar', type: 'attack', ac: 15 },
  result: { total: 17 },
};
const saveRoll: any = {
  request: { actorName: 'Goblin', purpose: 'Dexterity save', type: 'save', dc: 13 },
  result: { total: 9 },
};

describe('NPC Behind the Screen summary follows showTargetNumbers (#157)', () => {
  it('attack: shows AC when on, drops the clause when off, keeps hit/miss', () => {
    const on = formatNPCRollsSystemMessage([attackRoll], true);
    const off = formatNPCRollsSystemMessage([attackRoll], false);
    expect(on).toContain('(**hits** AC 15)');
    expect(off).toContain('(**hits**)');
    expect(off).not.toMatch(TARGET_PATTERN);
  });

  it('save: shows DC when on, drops the clause when off, keeps succeeds/fails', () => {
    const on = formatNPCRollsSystemMessage([saveRoll], true);
    const off = formatNPCRollsSystemMessage([saveRoll], false);
    expect(on).toContain('(fails DC 13)');
    expect(off).toContain('(fails)');
    expect(off).not.toMatch(TARGET_PATTERN);
  });

  it('default (no second argument) keeps the number, as before', () => {
    expect(formatNPCRollsSystemMessage([attackRoll])).toContain('(**hits** AC 15)');
  });
});
