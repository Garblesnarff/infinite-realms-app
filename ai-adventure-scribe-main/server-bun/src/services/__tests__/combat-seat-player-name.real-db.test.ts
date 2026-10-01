/**
 * Run M10 (#2438): the PC "The Apprentice" fought an enemy the engine seated as "Apprentice".
 * The popup asked "Strike at Apprentice?", the initiative line said "Apprentice: 17 + 0", and
 * the move line read "Apprentice moved 30 ft toward The Apprentice".
 *
 * Both fixtures follow their real producers. The pending entry comes from `detectCombatEntry`
 * and the seats from `buildEntryParticipants`, so the names that reach `startCombat` are the
 * ones the entry route sends, including the `Hostile Creature` label the gate falls back to
 * when the only creature the reply references is the player. The envelope is the shape
 * `applyCombatEntryGate` parses (`combat_transition: 'start'`, an empty `combatants`, the DM's
 * prose in `text`). The second test replays a stale `/enter` body that still carries the
 * collided name, which only the seating service can stop.
 *
 * Real database: the name is chosen inside `CombatEncounterService.startCombat` and stored on
 * the participant row, and the seating line is built from the rows it returns.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts. Refuses every target
 * except the dedicated CI Postgres at 127.0.0.1:55432 because it deletes stale fixtures first.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, like } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';
import {
  campaignChunks,
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipants,
  gameSessions,
  starterCampaigns,
} from '../../../../db/schema/index';

import type { CombatEntryResponse } from '../combat/combat-entry-gate.js';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';
const FIXTURE_OWNER_PREFIX = 'combat-seat-player-name-user-';

function assertSafeDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[combat-seat-player-name] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
    );
  }
  const isPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (
    !isPostgres ||
    parsed.hostname !== DEDICATED_REAL_DB_HOST ||
    parsed.port !== DEDICATED_REAL_DB_PORT
  ) {
    const target = parsed.hostname ? `${parsed.hostname}:${parsed.port || '(default)'}` : 'unknown';
    throw new Error(
      `[combat-seat-player-name] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeDatabase(realDbUrl);

if (!hasRealDb) {
  console.warn(
    '[combat-seat-player-name] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run these.',
  );
}

const { CombatEncounterService } = await importWithRealDb(
  () => import('../combat/combat-encounter-service.js'),
);
const { buildCombatSeatingTranscript, buildEntryParticipants, detectCombatEntry } =
  await importWithRealDb(() => import('../combat/combat-entry-gate.js'));
const { clearCampaignMonsterCache } = await importWithRealDb(
  () => import('../combat/campaign-monster-resolution.js'),
);

const PLAYER_NAME = 'The Apprentice';
const NARRATION =
  'You push past the shelves toward the vibration. The Bitter End Mercenary, a scarred sellsword, ' +
  'is ten feet away, blocked by a pillar, his blade low.';

describeWithDb('a seated enemy never takes the player character name (#2438)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId(FIXTURE_OWNER_PREFIX);
  const encounterIds: string[] = [];

  const starterCampaignId = testId('seat-bible');
  let campaignId: string;
  let characterId: string;
  const sessionIds: string[] = [];

  const player = () => ({ characterId, name: PLAYER_NAME, initiativeModifier: 1 });

  beforeAll(async () => {
    await db.delete(characters).where(like(characters.userId, `${FIXTURE_OWNER_PREFIX}%`));
    await db.delete(campaigns).where(like(campaigns.userId, `${FIXTURE_OWNER_PREFIX}%`));

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('seat-player-name-campaign') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: PLAYER_NAME, class: 'Wizard', level: 1 })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      dexterity: 12,
      armorClass: 11,
      maxHitPoints: 7,
      currentHitPoints: 7,
      speed: 30,
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      await db.delete(campaignChunks).where(eq(campaignChunks.campaignId, starterCampaignId));
      await db.delete(starterCampaigns).where(eq(starterCampaigns.id, starterCampaignId));
      for (const id of encounterIds) {
        await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, id));
        await db.delete(combatEncounters).where(eq(combatEncounters.id, id));
      }
      for (const id of sessionIds) await db.delete(gameSessions).where(eq(gameSessions.id, id));
      await db.delete(characters).where(eq(characters.id, characterId));
      await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      await closeRealDb();
    }
  });

  const newSession = async (sessionNumber: number, withBible = false): Promise<string> => {
    const [row] = await db
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        sessionNumber,
        status: 'active',
        ...(withBible ? { starterCampaignId } : {}),
      })
      .returning({ id: gameSessions.id });
    sessionIds.push(row.id);
    return row.id;
  };

  const startAndRecord = async (
    id: string,
    participants: Parameters<typeof CombatEncounterService.startCombat>[1],
  ) => {
    const state = await CombatEncounterService.startCombat(id, participants, false, userId);
    encounterIds.push(state.encounter.id);
    return state;
  };

  test('prose entry: the player-name hostile is seated as the creature the DM narrated', async () => {
    const id = await newSession(1);
    // The model referenced the player by a short form of their name and the mercenary only in
    // prose, so the gate derives no hostile of its own.
    const envelope: CombatEntryResponse = {
      text: NARRATION,
      combat_transition: 'start',
      scene_spec: null,
      combatants: [{ monster_id: '', name: 'Apprentice', count: 1 }],
      map_actions: [],
      combat_actions: [],
      roll_requests: [],
    };
    const pending = detectCombatEntry({
      sessionId: id,
      playerName: PLAYER_NAME,
      response: envelope,
    });
    expect(pending?.combatants.map((combatant) => combatant.name)).not.toContain('Apprentice');

    const participants = buildEntryParticipants(player(), pending?.combatants ?? [], {
      sceneDescription: pending?.sceneSpec.sceneDescription,
      source: pending?.trigger,
    });
    const state = await startAndRecord(id, participants as never);

    const hostiles = state.participants.filter((participant) => !participant.characterId);
    expect(hostiles.map((participant) => participant.name)).toEqual(['Bitter End Mercenary']);

    const line = buildCombatSeatingTranscript(state.participants, player(), 10);
    expect(line).toContain('Bitter End Mercenary: ');
    expect(line).not.toMatch(/Initiative — Apprentice:|\. Apprentice:/);
  });

  test('a stale /enter body that still names the hostile "Apprentice" is re-seated from the prose', async () => {
    const id = await newSession(2);
    const participants = buildEntryParticipants(player(), [{ name: 'Apprentice', count: 1 }], {
      sceneDescription: NARRATION,
      source: 'combat_transition',
    });
    const state = await startAndRecord(id, participants as never);

    expect(
      state.participants
        .filter((participant) => !participant.characterId)
        .map((participant) => participant.name),
    ).toEqual(['Bitter End Mercenary']);
    expect(state.participants.find((participant) => participant.characterId)?.name).toBe(
      PLAYER_NAME,
    );
  });

  test('with no creature in the prose the seat is the unnamed creature, never the player', async () => {
    const id = await newSession(3);
    const participants = buildEntryParticipants(player(), [{ name: 'Apprentice', count: 1 }], {
      sceneDescription: 'Combat begins where the characters already stand.',
      source: 'combat_transition',
    });
    const state = await startAndRecord(id, participants as never);

    expect(
      state.participants
        .filter((participant) => !participant.characterId)
        .map((participant) => participant.name),
    ).toEqual(['Unknown creature']);
  });

  describe('the collided seat takes a name of its own (#2444)', () => {
    const hostileNames = (state: Awaited<ReturnType<typeof startAndRecord>>): string[] =>
      state.participants
        .filter((participant) => !participant.characterId)
        .map((participant) => participant.name);
    const staleSeats = (count: number, prose: string) =>
      buildEntryParticipants(player(), [{ name: 'Apprentice', count }], {
        sceneDescription: prose,
        source: 'combat_transition',
      });

    beforeAll(async () => {
      await db.insert(starterCampaigns).values({
        id: starterCampaignId,
        slug: starterCampaignId,
        title: 'Seat Name Fixture Bible',
        genre: ['fixture'],
        tone: ['diagnostic'],
        difficulty: 'medium',
        premise: 'A bible that exists only to be seated from.',
      });
      // Chunk shapes follow the lore-keeper's: an NPC bio with a stat block, and one without.
      await db.insert(campaignChunks).values([
        {
          campaignId: starterCampaignId,
          chunkType: 'npc_tier1' as const,
          entityName: 'Captain Sarah Reeves',
          content: [
            '**Captain Sarah Reeves** (Human Fighter) - Stoic, scarred, pragmatic.',
            '*   *HP:* 45, *AC:* 15 (chain shirt).',
            '*   *Attack:* +3 to hit, 1d8 slashing (longsword)',
          ].join('\n'),
        },
        {
          campaignId: starterCampaignId,
          chunkType: 'npc_tier1' as const,
          entityName: 'Quill',
          content:
            '**Quill** (Human Scribe) - Nervous, ink-stained.\n*   **Goal:** Finish the ledger.',
        },
      ]);
      clearCampaignMonsterCache();
    });

    test('the bible NPC the prose names, word for word, is the seat', async () => {
      const id = await newSession(4, true);
      const state = await startAndRecord(
        id,
        staleSeats(1, 'Captain Sarah Reeves levels her pistol at you.') as never,
      );

      expect(hostileNames(state)).toEqual(['Captain Sarah Reeves']);
      // The stat block came with the name: the authored 45 HP (before party scaling), not the
      // generic fallback.
      const [row] = await db
        .select({ profile: combatParticipants.monsterAttack })
        .from(combatParticipants)
        .where(eq(combatParticipants.encounterId, state.encounter.id))
        .then((rows) => rows.filter((candidate) => candidate.profile));
      expect(row?.profile).toMatchObject({
        source: 'authored',
        attacks: [{ attackBonus: 3 }],
        partyScaling: { rawMaxHp: 45 },
      });
    });

    test('two collided seats never share a name, whoever the prose names', async () => {
      const id = await newSession(5, true);
      const state = await startAndRecord(
        id,
        staleSeats(2, 'Quill hides behind Captain Sarah Reeves, who has already drawn.') as never,
      );

      expect(hostileNames(state).sort()).toEqual(['Captain Sarah Reeves', 'Quill']);
    });

    test('two collided seats with only a generic name in the prose are numbered', async () => {
      const id = await newSession(6);
      const state = await startAndRecord(id, staleSeats(2, NARRATION) as never);

      expect(hostileNames(state).sort()).toEqual([
        'Bitter End Mercenary 1',
        'Bitter End Mercenary 2',
      ]);
    });

    test('two collided seats with nothing in the prose are numbered, never the player', async () => {
      const id = await newSession(7);
      const state = await startAndRecord(
        id,
        staleSeats(2, 'Combat begins where the characters already stand.') as never,
      );

      expect(hostileNames(state).sort()).toEqual(['Unknown creature 1', 'Unknown creature 2']);
    });

    test('a seat that did not collide keeps its name beside a collided one', async () => {
      const id = await newSession(8);
      const participants = [
        ...staleSeats(1, NARRATION),
        ...buildEntryParticipants(player(), [{ name: 'Bitter End Mercenary', count: 1 }], {
          sceneDescription: NARRATION,
          source: 'combat_transition',
        }).slice(1),
      ];
      const state = await startAndRecord(id, participants as never);

      expect(hostileNames(state).sort()).toEqual([
        'Bitter End Mercenary',
        'Bitter End Mercenary 1',
      ]);
    });
  });
});
