/**
 * #1704 shadow: a DM reply that narrates a confrontation without starting an encounter is
 * reported as `confrontation_without_combat_entry` (pattern names only). The reply itself is
 * never changed. Tests use recorded reply text only; no live DM calls.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/client-failure-reporting', () => ({
  reportNarrationShadowHit: vi.fn(),
}));

import {
  CONFRONTATION_WITHOUT_COMBAT_ENTRY_SHADOW_REASON,
  confrontationVerbPatterns,
  hasCombatEntrySignal,
  shadowConfrontationWithoutCombatEntry,
} from '../confrontation-without-combat-entry-shadow';

import logger from '@/lib/logger';
import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

describe('confrontationVerbPatterns', () => {
  it('matches each hostile verb in the #1704 list', () => {
    expect(confrontationVerbPatterns('The boxer attacks without warning.')).toEqual(['attacks']);
    expect(confrontationVerbPatterns('He rushes across the ring toward you.')).toEqual(['rushes']);
    expect(
      confrontationVerbPatterns('The bruiser charges forward with lowered shoulders.'),
    ).toEqual(['charges']);
    expect(confrontationVerbPatterns('She swings a heavy hook at your jaw.')).toEqual(['swings']);
    expect(confrontationVerbPatterns('He punches straight at your ribs.')).toEqual(['punches']);
    expect(confrontationVerbPatterns('The fighter squares up across the canvas.')).toEqual([
      'squares_up',
    ]);
    expect(confrontationVerbPatterns('The cutthroat lunges forward from the shadows.')).toEqual([
      'lunges',
    ]);
  });

  it('matches past and progressive forms and returns sorted unique names', () => {
    expect(
      confrontationVerbPatterns(
        'The champion squared up, then rushed in and swung wildly as the crowd roared.',
      ),
    ).toEqual(['rushes', 'squares_up', 'swings']);
  });

  it('ignores quoted dialogue and negated sentences', () => {
    expect(
      confrontationVerbPatterns('The promoter says, "He rushes everyone who steps in the ring."'),
    ).toEqual([]);
    expect(confrontationVerbPatterns('The boxer does not attack and never swings first.')).toEqual(
      [],
    );
  });

  it('returns empty for peaceful narration or empty input', () => {
    expect(confrontationVerbPatterns('The bell rings softly as the crowd settles.')).toEqual([]);
    expect(confrontationVerbPatterns(null)).toEqual([]);
    expect(confrontationVerbPatterns(undefined)).toEqual([]);
  });
});

describe('hasCombatEntrySignal', () => {
  it('detects combat_transition === "start"', () => {
    expect(hasCombatEntrySignal({ combat_transition: 'start' })).toBe(true);
    expect(hasCombatEntrySignal({ combat_transition: 'none' })).toBe(false);
  });

  it('detects a targeted map_action and ignores untargeted ones', () => {
    expect(hasCombatEntrySignal({ map_actions: [{ action: 'move', entityId: 'boxer-1' }] })).toBe(
      true,
    );
    expect(hasCombatEntrySignal({ map_actions: [{ action: 'forced_move', target: 'hero' }] })).toBe(
      true,
    );
    expect(hasCombatEntrySignal({ map_actions: [{ action: 'move', entityId: '  ' }] })).toBe(false);
    expect(hasCombatEntrySignal({ map_actions: [{ action: 'forced_move', target: '' }] })).toBe(
      false,
    );
  });

  it('detects any combat_action', () => {
    expect(hasCombatEntrySignal({ combat_actions: [{ action_type: 'attack' }] })).toBe(true);
    expect(hasCombatEntrySignal({ combat_actions: [] })).toBe(false);
  });

  it('detects attack and initiative roll requests, but not check or save requests', () => {
    expect(hasCombatEntrySignal({ roll_requests: [{ type: 'attack' }] })).toBe(true);
    expect(hasCombatEntrySignal({ roll_requests: [{ type: 'initiative' }] })).toBe(true);
    expect(hasCombatEntrySignal({ roll_requests: [{ type: 'check' }] })).toBe(false);
    expect(hasCombatEntrySignal({ roll_requests: [{ type: 'save' }] })).toBe(false);
  });
});

describe('shadowConfrontationWithoutCombatEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the Hark 11-21 shape: NPC rushes the hero and asks for a Strength check with no combat entry', () => {
    const reply = {
      text: 'The contender squares up, then rushes you across the sawdust floor. Roll Strength to hold your ground.',
      combat_transition: 'none',
      map_actions: [],
      combat_actions: [],
      roll_requests: [{ type: 'check' }],
    };

    shadowConfrontationWithoutCombatEntry({
      reply,
      sessionId: 'sess-1704-fixture',
      inCombat: false,
    });

    expect(reportNarrationShadowHit).toHaveBeenCalledTimes(1);
    expect(reportNarrationShadowHit).toHaveBeenCalledWith(
      'confrontation_without_combat_entry',
      'sess-1704-fixture',
      ['rushes', 'squares_up'],
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_SHADOW',
      expect.objectContaining({
        reason: CONFRONTATION_WITHOUT_COMBAT_ENTRY_SHADOW_REASON,
        sessionId: 'sess-1704-fixture',
        branch: 'narrative',
        patterns: ['rushes', 'squares_up'],
      }),
    );
  });

  it('does not report when an encounter is already active', () => {
    shadowConfrontationWithoutCombatEntry({
      reply: { text: 'The contender rushes you and swings hard.', combat_transition: 'none' },
      sessionId: 'sess-1704-fixture',
      inCombat: true,
    });
    expect(reportNarrationShadowHit).not.toHaveBeenCalled();
  });

  it('does not report when the reply starts combat or carries a combat-entry signal', () => {
    const text = 'The contender rushes you and swings hard.';
    shadowConfrontationWithoutCombatEntry({
      reply: { text, combat_transition: 'start' },
      sessionId: 'sess-1704-fixture',
      inCombat: false,
    });
    shadowConfrontationWithoutCombatEntry({
      reply: { text, roll_requests: [{ type: 'initiative' }] },
      sessionId: 'sess-1704-fixture',
      inCombat: false,
    });
    shadowConfrontationWithoutCombatEntry({
      reply: { text, roll_requests: [{ type: 'attack' }] },
      sessionId: 'sess-1704-fixture',
      inCombat: false,
    });
    shadowConfrontationWithoutCombatEntry({
      reply: { text, combat_actions: [{ action_type: 'attack' }] },
      sessionId: 'sess-1704-fixture',
      inCombat: false,
    });
    shadowConfrontationWithoutCombatEntry({
      reply: { text, map_actions: [{ action: 'move', entityId: 'contender-1' }] },
      sessionId: 'sess-1704-fixture',
      inCombat: false,
    });
    expect(reportNarrationShadowHit).not.toHaveBeenCalled();
  });

  it('never mutates the reply and fails open if telemetry throws', () => {
    vi.mocked(reportNarrationShadowHit).mockImplementationOnce(() => {
      throw new Error('telemetry down');
    });
    const reply = { text: 'The boxer lunges at you.', combat_transition: 'none' };
    const snapshot = { ...reply };
    expect(() =>
      shadowConfrontationWithoutCombatEntry({
        reply,
        sessionId: 'sess-1704-fixture',
        inCombat: false,
      }),
    ).not.toThrow();
    expect(reply).toEqual(snapshot);
  });
});
