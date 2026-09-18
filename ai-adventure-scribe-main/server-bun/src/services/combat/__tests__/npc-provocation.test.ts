import { beforeEach, describe, expect, it, mock } from 'bun:test';

const updateReturning = mock(async () => [{ id: 'npc-1' }]);
const updateWhere = mock(() => ({ returning: updateReturning }));
const updateSet = mock(() => ({ where: updateWhere }));
const dbUpdate = mock(() => ({ set: updateSet }));

const selectLimit = mock(async (): Promise<Array<{ id: string }>> => []);
const selectWhere = mock(() => ({ limit: selectLimit }));
const selectFrom = mock(() => ({ where: selectWhere }));
const dbSelect = mock(() => ({ from: selectFrom }));

const db = { select: dbSelect, update: dbUpdate };
const recordDmTacticalFact = mock(async () => {});
const info = mock(() => {});
const warn = mock(() => {});

mock.module('../../../../../db/client', () => ({ db }));
mock.module('../tactical-action-service.js', () => ({ recordDmTacticalFact }));
mock.module('../../../lib/logger.js', () => ({
  logger: { warn },
  combatLogger: { info },
}));

const { markPlayerDamageProvocation } = await import('../npc-provocation.js');

const player = { id: 'player-1', participantType: 'player' as const };
const npc = {
  id: 'npc-1',
  name: 'The Professor',
  participantType: 'npc' as const,
  encounter: { sessionId: 'session-1' },
};

describe('markPlayerDamageProvocation', () => {
  beforeEach(() => {
    updateReturning.mockReset();
    updateReturning.mockResolvedValue([{ id: 'npc-1' }]);
    selectLimit.mockReset();
    selectLimit.mockResolvedValue([]);
    dbSelect.mockClear();
    dbUpdate.mockClear();
    info.mockClear();
    warn.mockClear();
    recordDmTacticalFact.mockClear();
  });

  it('marks a damaged NPC and emits the hostility line once', async () => {
    const lines = await markPlayerDamageProvocation({
      encounterId: 'encounter-1',
      source: player,
      target: npc,
      damage: 3,
    });

    expect(lines).toEqual(['⚙️ Engine: The Professor turns hostile.']);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    expect(recordDmTacticalFact).toHaveBeenCalledWith(
      'session-1',
      '⚙️ Engine: The Professor turns hostile.',
    );

    updateReturning.mockResolvedValueOnce([]);
    expect(
      await markPlayerDamageProvocation({
        encounterId: 'encounter-1',
        source: player,
        target: npc,
        damage: 2,
      }),
    ).toEqual([]);
    expect(recordDmTacticalFact).toHaveBeenCalledTimes(1);
  });

  it('does not provoke a miss or zero-damage hit', async () => {
    expect(
      await markPlayerDamageProvocation({
        encounterId: 'encounter-1',
        source: player,
        target: npc,
        damage: 0,
      }),
    ).toEqual([]);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it('leaves an ally unchanged and logs NPC_PROVOKE_IGNORED_ALLY', async () => {
    const ally = { ...npc, participantType: 'ally' };

    expect(
      await markPlayerDamageProvocation({
        encounterId: 'encounter-1',
        source: player,
        target: ally,
        damage: 3,
      }),
    ).toEqual([]);
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'NPC_PROVOKE_IGNORED_ALLY', participantId: 'npc-1' }),
    );
  });

  it('leaves a party companion unchanged and logs NPC_PROVOKE_IGNORED_ALLY', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 'companion-row' }]);
    const companion = {
      id: 'companion-1',
      name: 'Mira',
      participantType: 'player',
      characterId: 'character-1',
      encounter: { sessionId: 'session-1' },
    };

    expect(
      await markPlayerDamageProvocation({
        encounterId: 'encounter-1',
        source: player,
        target: companion,
        damage: 3,
      }),
    ).toEqual([]);
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'NPC_PROVOKE_IGNORED_ALLY', participantId: 'companion-1' }),
    );
  });

  it('does not let a party companion provoke an NPC', async () => {
    selectLimit.mockResolvedValueOnce([{ id: 'companion-row' }]);
    const companion = {
      id: 'companion-1',
      name: 'Mira',
      participantType: 'player',
      characterId: 'character-1',
      encounter: { sessionId: 'session-1' },
    };

    expect(
      await markPlayerDamageProvocation({
        encounterId: 'encounter-1',
        source: companion,
        target: npc,
        damage: 3,
      }),
    ).toEqual([]);
    expect(dbUpdate).not.toHaveBeenCalled();
    expect(recordDmTacticalFact).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'NPC_PROVOKE_IGNORED_ALLY', participantId: 'companion-1' }),
    );
  });
});
