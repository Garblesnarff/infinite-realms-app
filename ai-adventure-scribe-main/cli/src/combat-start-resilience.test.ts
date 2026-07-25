import { describe, expect, it, vi } from 'vitest';

import { IDENTICAL_FAILURE_LIMIT, failureFingerprint, runAutoTurns } from './auto';
import { CombatStartError } from '../../src/services/combat/combat-start-failure';

const DM_ENVELOPE = {
  text: 'You draw your longsword and step forward.',
  combat_transition: 'start',
  scene_spec: { environment: 'tavern', sessionId: 'eternal_feast_01', seed: 12345 },
  combatants: [{ monster_id: 'srd:bandit', name: 'Aggressive Patron', count: 1 }],
};

const combatStartFailure = () =>
  Object.assign(
    new CombatStartError(
      500,
      'participants',
      'insert select error',
      '{"error":"Failed to start combat encounter","stage":"participants"}',
      DM_ENVELOPE,
    ),
    // The headless client attaches the provider that served the (successful) DM turn.
    { provider: 'openrouter', model: 'mistral-small-creative' },
  );

const clientThatAlwaysFailsToStartCombat = () => ({
  pendingRolls: [] as const,
  availableOptions: ['I attack the nearest patron.'],
  roll: () => ({ skipped: false }),
  play: vi.fn(async () => {
    throw combatStartFailure();
  }),
});

describe('auto-play resilience to a hard combat-start failure', () => {
  it(`stops after ${IDENTICAL_FAILURE_LIMIT} identical consecutive failures with a verdict`, async () => {
    const client = clientThatAlwaysFailsToStartCombat();
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
    expect(summary.verdict).toContain('combat_start:500:participants');
  });

  it('counts a failed combat start as a transport error', async () => {
    const summary = await runAutoTurns(clientThatAlwaysFailsToStartCombat(), 5, () => {}, {
      delayMs: 0,
      sleep: async () => {},
    });

    expect(summary.transportErrors).toBe(IDENTICAL_FAILURE_LIMIT);
    expect(summary.contractViolations).toBe(0);
  });

  it('records provider telemetry for turns that failed after the DM answered', async () => {
    const summary = await runAutoTurns(clientThatAlwaysFailsToStartCombat(), 5, () => {}, {
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
        throw combatStartFailure();
      }),
    };

    const summary = await runAutoTurns(client, 5, () => {}, { delayMs: 0, sleep: async () => {} });

    expect(client.play).toHaveBeenCalledTimes(5);
    expect(summary.turnsCompleted).toBe(1);
    expect(summary.verdict).toBeUndefined();
  });
});

describe('combat start failure reporting', () => {
  it('carries the DM envelope and the server response body for the transcript', () => {
    const detail = combatStartFailure().toTranscriptDetail();

    expect(detail).toMatchObject({
      kind: 'combat_start_failure',
      status: 500,
      stage: 'participants',
      detail: 'insert select error',
    });
    expect(detail.dmEnvelope).toEqual(DM_ENVELOPE);
    expect(String(detail.responseBody)).toContain('Failed to start combat encounter');
  });

  it('fingerprints identical failures identically and distinct ones distinctly', () => {
    expect(failureFingerprint(combatStartFailure())).toBe(
      failureFingerprint(combatStartFailure()),
    );
    expect(failureFingerprint(combatStartFailure())).not.toBe(
      failureFingerprint(
        new CombatStartError(500, 'map_generation', 'other reason', '', DM_ENVELOPE),
      ),
    );
  });
});
