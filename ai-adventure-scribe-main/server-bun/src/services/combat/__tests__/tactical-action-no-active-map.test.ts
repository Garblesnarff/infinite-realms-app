/**
 * #1779 §3 — a DM map action refused for `no_active_map` is never again a silent null.
 *
 * Prod session 5ebaffab, 03:25:10: the model issued a tactical shove against Dishwasher Prime
 * while reporting `combat_transition` as not-start. The engine correctly refused it — and then
 * had nowhere to escalate, so the one moment where the system could see the model fighting
 * outside an encounter was logged as a routine dropped action and forgotten.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const recorded: Array<{ event: string; properties: Record<string, unknown> }> = [];
const logged: Array<{ level: string; message: string; data: unknown }> = [];

mock.module('../combat-events.js', () => ({
  trackCombatEvent: (event: string, properties: Record<string, unknown>) =>
    recorded.push({ event, properties }),
}));

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (data: unknown, message: string) => logged.push({ level: 'warn', message, data }),
  error: (data: unknown, message: string) => logged.push({ level: 'error', message, data }),
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../../lib/alerting.js', () => ({ alert: () => {} }));
mock.module('../../collaboration/room-manager.js', () => ({ broadcastToRoom: () => {} }));

// No active board — exactly the state the four hostile turns ran in.
mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
  loadLatestTacticalMapRow: async () => null,
  saveTacticalMap: async () => {},
  saveTacticalMapRow: async () => {},
}));

const { applyDmTacticalActions } = await import('../tactical-action-service.js');

describe('applyDmTacticalActions with no active encounter', () => {
  beforeEach(() => {
    recorded.length = 0;
    logged.length = 0;
  });

  it('emits a combat_integrity event naming the entity the DM was fighting', async () => {
    const result = await applyDmTacticalActions('session-1', [
      {
        action: 'forced_move',
        target: 'dishwasher-prime',
        mode: 'shove',
        origin: null,
        distance: 5,
        destination: { x: 5, y: 5 },
      },
    ]);

    expect(result.degraded).toHaveLength(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].event).toBe('tactical_action_without_encounter');
    expect(recorded[0].properties).toMatchObject({
      sessionId: 'session-1',
      action: 'forced_move',
      entityId: 'dishwasher-prime',
    });
  });

  it('logs it loudly rather than as a routine dropped action', async () => {
    await applyDmTacticalActions('session-1', [
      { action: 'move', entityId: 'dishwasher-prime', x: 3, y: 4, changes: null },
    ]);

    const escalated = logged.find((entry) => entry.level === 'error');
    expect(escalated?.message).toContain('combat entry gate did not fire');
    expect((escalated?.data as { alert?: boolean }).alert).toBe(true);
  });
});
