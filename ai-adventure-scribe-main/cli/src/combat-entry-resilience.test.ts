import { describe, expect, it, vi } from 'vitest';

import { IDENTICAL_FAILURE_LIMIT, failureFingerprint, runAutoTurns } from './auto';

const DM_ENVELOPE = {
  text: 'You draw your longsword and step forward.',
  combat_transition: 'none',
  combat_entry_pending: {
    trigger: 'combat_transition',
    detail: 'combat_entry_pending',
    sceneSpec: { environment: 'tavern', sessionId: 'eternal_feast_01', seed: 12345 },
    sceneSpecSynthesized: false,
    combatants: [{ monsterId: 'srd:bandit', name: 'Aggressive Patron', count: 1 }],
  },
};

type CombatEntryFailure = Error & {
  category: 'transport';
  status: number;
  stage: 'entry';
  detail: string;
  responseBody: string;
  envelope: unknown;
  fingerprint: string;
  toTranscriptDetail: () => Record<string, unknown>;
};

const combatEntryFailure = (
  overrides: Partial<Pick<CombatEntryFailure, 'status' | 'stage' | 'detail'>> = {},
): CombatEntryFailure & { provider: string; model: string } => {
  const status = overrides.status ?? 409;
  const stage = overrides.stage ?? 'entry';
  const detail = overrides.detail ?? 'Combat entry is no longer available';
  const responseBody = JSON.stringify({ error: detail });
  const error = new Error(
    `Combat entry failed (${status}, stage: ${stage}): ${detail}`,
  ) as CombatEntryFailure;
  Object.assign(error, {
    name: 'CombatEntryError',
    category: 'transport' as const,
    status,
    stage,
    detail,
    responseBody,
    envelope: DM_ENVELOPE,
    fingerprint: `combat_entry:${status}:${stage}:${detail}`,
    toTranscriptDetail: () => ({
      kind: 'combat_entry_failure',
      status,
      stage,
      detail,
      responseBody,
      dmEnvelope: DM_ENVELOPE,
    }),
  });
  return Object.assign(error, {
    // The headless client attaches the provider that served the successful DM turn.
    provider: 'openrouter',
    model: 'mistral-small-creative',
  });
};

const clientThatAlwaysFailsToEnterCombat = (): {
  pendingRolls: readonly [];
  availableOptions: string[];
  roll: () => { skipped: boolean };
  play: ReturnType<typeof vi.fn>;
} => ({
  pendingRolls: [] as const,
  availableOptions: ['I attack the nearest patron.'],
  roll: () => ({ skipped: false }),
  play: vi.fn(async () => {
    throw combatEntryFailure();
  }),
});

describe('auto-play resilience to a hard combat-entry failure', () => {
  it(`stops after ${IDENTICAL_FAILURE_LIMIT} identical consecutive failures with a verdict`, async () => {
    const client = clientThatAlwaysFailsToEnterCombat();
    const errors: unknown[] = [];

    const summary = await runAutoTurns(client, 20, (error) => errors.push(error), {
      delayMs: 0,
      sleep: async () => {},
    });

    expect(client.play).toHaveBeenCalledTimes(IDENTICAL_FAILURE_LIMIT);
    expect(errors).toHaveLength(IDENTICAL_FAILURE_LIMIT);
    expect(summary.turnsFailed).toBe(IDENTICAL_FAILURE_LIMIT);
    expect(summary.turnsCompleted).toBe(0);
    expect(summary.turnsSkipped).toBe(20 - IDENTICAL_FAILURE_LIMIT);
    expect(summary.verdict).toContain('identical consecutive failures');
    expect(summary.verdict).toContain('combat_entry:409:entry');
  });

  it('counts a failed combat entry as a transport error', async () => {
    const summary = await runAutoTurns(clientThatAlwaysFailsToEnterCombat(), 5, () => {}, {
      delayMs: 0,
      sleep: async () => {},
    });

    expect(summary.transportErrors).toBe(IDENTICAL_FAILURE_LIMIT);
    expect(summary.contractViolations).toBe(0);
  });

  it('records provider telemetry for turns that failed after the DM answered', async () => {
    const summary = await runAutoTurns(clientThatAlwaysFailsToEnterCombat(), 5, () => {}, {
      delayMs: 0,
      sleep: async () => {},
    });

    // Without this the provider totals silently under-count every broken turn.
    expect(summary.providerCounts).toEqual({ openrouter: IDENTICAL_FAILURE_LIMIT });
    expect(summary.providerModelCounts).toEqual({
      'openrouter/mistral-small-creative': IDENTICAL_FAILURE_LIMIT,
    });
  });

  it('keeps running when consecutive failures differ', async () => {
    let attempt = 0;
    const client = {
      pendingRolls: [] as const,
      availableOptions: ['I wait.'],
      roll: () => ({ skipped: false }),
      play: vi.fn(async () => {
        attempt += 1;
        throw new Error(`distinct failure ${attempt}`);
      }),
    };

    const summary = await runAutoTurns(client, 5, () => {}, { delayMs: 0, sleep: async () => {} });

    expect(client.play).toHaveBeenCalledTimes(5);
    expect(summary.verdict).toBeUndefined();
    expect(summary.turnsSkipped).toBe(0);
  });

  it('resets the streak after a successful turn', async () => {
    let call = 0;
    const client = {
      pendingRolls: [] as const,
      availableOptions: ['I wait.'],
      roll: () => ({ skipped: false }),
      play: vi.fn(async () => {
        call += 1;
        // fail, fail, succeed, fail, fail — never three in a row.
        if (call === 3) return { provider: 'openrouter', model: 'm' };
        throw combatEntryFailure();
      }),
    };

    const summary = await runAutoTurns(client, 5, () => {}, { delayMs: 0, sleep: async () => {} });

    expect(client.play).toHaveBeenCalledTimes(5);
    expect(summary.turnsCompleted).toBe(1);
    expect(summary.verdict).toBeUndefined();
  });
});

describe('combat-entry failure reporting', () => {
  it('carries the DM envelope and server response body for the transcript', () => {
    const detail = combatEntryFailure().toTranscriptDetail();

    expect(detail).toMatchObject({
      kind: 'combat_entry_failure',
      status: 409,
      stage: 'entry',
      detail: 'Combat entry is no longer available',
    });
    expect(detail.dmEnvelope).toEqual(DM_ENVELOPE);
    expect(String(detail.responseBody)).toContain('Combat entry is no longer available');
  });

  it('fingerprints identical failures identically and distinct ones distinctly', () => {
    expect(failureFingerprint(combatEntryFailure())).toBe(failureFingerprint(combatEntryFailure()));
    expect(failureFingerprint(combatEntryFailure())).not.toBe(
      failureFingerprint(combatEntryFailure({ status: 500, detail: 'other reason' })),
    );
  });
});
