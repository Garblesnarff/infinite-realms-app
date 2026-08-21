/**
 * AC 10 is a legal 5e number (unarmored, DEX 10). It is never a sentinel for "unset".
 * Unset is NULL. The attack engine must resolve a stored 10 against 10, not rewrite it
 * to GENERIC_NPC_STATS (12). #1871, after #1864's honest equipment-derived ACs.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

type LogPayload = Record<string, unknown>;

const warn = mock((_payload: LogPayload) => {});

mock.module('../../../lib/logger.js', () => ({
  logger: { warn, info: mock(() => {}), debug: mock(() => {}), error: mock(() => {}) },
}));

const { seatParticipantArmorClass, resolveParticipantArmorClass } =
  await import('../participant-armor-class.js');
const { GENERIC_NPC_STATS } = await import('../srd-monster-resolution.js');

describe('seating a participant armor class', () => {
  test('a stored AC 10 is seated as 10, not rewritten', () => {
    expect(seatParticipantArmorClass({ characterArmorClass: 10 })).toBe(10);
  });

  test('no AC source writes NULL rather than an in-band 10', () => {
    expect(seatParticipantArmorClass({})).toBeNull();
    expect(
      seatParticipantArmorClass({
        characterArmorClass: null,
        npcArmorClass: null,
        monsterArmorClass: null,
      }),
    ).toBeNull();
  });

  test('a monster without a catalog row still seats the generic 12, which is a real number', () => {
    expect(seatParticipantArmorClass({ monsterArmorClass: GENERIC_NPC_STATS.armorClass })).toBe(12);
  });

  test('character AC wins over a leftover NPC or monster number', () => {
    expect(
      seatParticipantArmorClass({
        characterArmorClass: 10,
        npcArmorClass: 15,
        monsterArmorClass: 12,
      }),
    ).toBe(10);
  });
});

describe('resolving target AC at attack time', () => {
  beforeEach(() => {
    warn.mockClear();
  });

  test('a participant with a stored, real AC 10 is attacked vs 10, not 12', () => {
    // The live-character collision: ten characters sit at AC 10 after #1864. The old
    // `armorClass !== 10` predicate silently substituted GENERIC_NPC_STATS (12).
    expect(resolveParticipantArmorClass(10)).toBe(10);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a participant with NULL AC falls back to generic 12 and warns', () => {
    expect(resolveParticipantArmorClass(null, { participantId: 'p-1' })).toBe(12);
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0]?.[0] ?? {};
    expect(payload).toMatchObject({
      participantId: 'p-1',
      armorClass: GENERIC_NPC_STATS.armorClass,
    });
    expect(String(payload.consequence)).toContain('AC 12');
  });

  test('undefined is unset, same as NULL', () => {
    expect(resolveParticipantArmorClass(undefined)).toBe(12);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('any other stored AC is used as-is', () => {
    expect(resolveParticipantArmorClass(16)).toBe(16);
    expect(resolveParticipantArmorClass(8)).toBe(8);
    expect(warn).not.toHaveBeenCalled();
  });
});
