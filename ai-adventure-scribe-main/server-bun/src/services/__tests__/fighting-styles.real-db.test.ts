/**
 * Fighter fighting styles on the live attack route (#824).
 *
 * Hark's light crossbow showed +4 on the sheet, the tray, and the engine line.
 * DEX +2 and proficiency +2 were already there. Archery's +2 was not. The same
 * route owes Dueling its +2 damage and Great Weapon Fighting its damage-die reroll.
 *
 * The fixture follows the producers the route already reads: `characters.fighting_styles`,
 * `character_stats` ability scores, and an equipped `inventory_items` row whose name is
 * the SRD catalog name (`Crossbow, light`, `Longsword`, `Greataxe`, `Javelin`). Bolts are
 * a carried ammunition row, the same check `listCarriedWeaponProfiles` uses. Only
 * authentication is mocked. The proposal and the resolution both go through
 * `createRequestPipelineApp` and `POST /v1/combat/:id/intent`.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
} from '../../../../db/schema/index';
import { setRngSeed } from '../../lib/rng.js';

const USER_PREFIX = 'fighting-style-user-';
const userId = `${USER_PREFIX}${process.pid}`;

mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/, '');
    return token && token.startsWith(USER_PREFIX)
      ? { user: { userId: token, email: 'style@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { intentRoutes } = await importWithRealDb(() => import('../../routes/v1/combat/intents.js'));

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) {
  console.warn('[fighting-styles] SKIPPED: set DATABASE_URL to a scratch Postgres to run these.');
}

describeWithDb('fighting styles on the live attack route (#824)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let targetId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('style-camp') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: 'Bram',
        level: 1,
        class: 'Fighter',
        fightingStyles: ['archery'],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      dexterity: 14,
      armorClass: 16,
      maxHitPoints: 12,
      currentHitPoints: 12,
    });
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Bram',
          participantType: 'player',
          turnOrder: 0,
          initiative: 18,
          armorClass: 16,
          maxHp: 12,
          speed: 30,
        },
        {
          encounterId,
          name: 'Practice Dummy',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 1,
          armorClass: 10,
          maxHp: 400,
          speed: 0,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    targetId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 12, maxHp: 12, isConscious: true },
      { participantId: targetId, currentHp: 400, maxHp: 400, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb || !characterId) return;
    if (encounterId) {
      await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
      await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    }
    if (sessionId) await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    if (campaignId) await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  beforeEach(async () => {
    setRngSeed(undefined);
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false, reactionUsed: false })
      .where(eq(combatParticipants.id, heroId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 400, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, targetId));
  });

  async function equip(styles: string[], weapons: string[], extra: string[] = []): Promise<void> {
    await db
      .update(characters)
      .set({ fightingStyles: styles })
      .where(eq(characters.id, characterId));
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
    if (weapons.length || extra.length) {
      await db.insert(inventoryItems).values([
        ...weapons.map((name) => ({
          characterId,
          name,
          itemType: 'weapon' as const,
          isEquipped: true,
          quantity: 1,
        })),
        ...extra.map((name) => ({
          characterId,
          name,
          itemType: 'ammunition' as const,
          isEquipped: false,
          quantity: 20,
        })),
      ]);
    }
  }

  async function post(body: unknown): Promise<Record<string, any>> {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
        body: JSON.stringify(body),
      }),
    );
    const payload = (await response.json()) as Record<string, any>;
    expect(response.status, JSON.stringify(payload)).toBe(200);
    return payload;
  }

  async function version(): Promise<number> {
    const [row] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row!.version;
  }

  async function attack(d20: number, weaponName?: string): Promise<Record<string, any>> {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false, reactionUsed: false })
      .where(eq(combatParticipants.id, heroId));
    const weaponId = weaponName
      ? (
          await db
            .select({ id: inventoryItems.id })
            .from(inventoryItems)
            .where(
              and(eq(inventoryItems.characterId, characterId), eq(inventoryItems.name, weaponName)),
            )
        )[0]?.id
      : undefined;
    const expectedVersion = await version();
    const intent = {
      type: 'attack',
      actorId: heroId,
      targetId,
      expectedVersion,
      ...(weaponId ? { weaponId } : {}),
    };
    const proposed = await post({ phase: 'propose', intent, origin: 'action_bar' });
    const committed = await post({
      intent: { ...intent, d20, actionId: testId('attack') },
      origin: 'action_bar',
    });
    return { proposed, committed };
  }

  test('Archery makes a light crossbow +6 on the tray and the engine line', async () => {
    await equip(['archery'], ['Crossbow, light'], ['Crossbow bolts']);
    const { proposed, committed } = await attack(15);
    expect(proposed.proposal).toMatchObject({ legal: true, attackBonus: 6 });
    expect(committed.result.attackBonus).toBe(6);
    expect(JSON.stringify(committed.engineRows)).toContain('+ 6');
  });

  test('Archery does not add to a thrown javelin', async () => {
    await equip(['Archery'], ['Javelin']);
    const { proposed } = await attack(15);
    // STR 16 (+3) + proficiency +2. A javelin is a melee weapon.
    expect(proposed.proposal.attackBonus).toBe(5);
  });

  test('Dueling adds +2 damage with a longsword, including beside a shield', async () => {
    const random = spyOn(Math, 'random').mockReturnValue(0);
    try {
      await equip(['dueling'], ['Longsword']);
      const bare = await attack(15);
      // Die 1 + STR +3 + Dueling +2.
      expect(bare.committed.result.finalDamage).toBe(6);

      await db.insert(inventoryItems).values({
        characterId,
        name: 'Shield',
        itemType: 'armor',
        isEquipped: true,
        quantity: 1,
      });
      const shielded = await attack(15);
      expect(shielded.committed.result.finalDamage).toBe(6);
    } finally {
      random.mockRestore();
    }
  });

  test('Dueling does not add when a second weapon is out or the weapon is two-handed', async () => {
    const random = spyOn(Math, 'random').mockReturnValue(0);
    try {
      await equip(['Dueling'], ['Longsword', 'Dagger']);
      const paired = await attack(15, 'Longsword');
      // Die 1 + STR +3. The dagger is another weapon, so no Dueling.
      expect(paired.committed.result.finalDamage).toBe(4);

      await equip(['dueling'], ['Greataxe']);
      const great = await attack(15);
      expect(great.committed.result.finalDamage).toBe(4);
    } finally {
      random.mockRestore();
    }
  });

  test('Great Weapon Fighting rerolls a 1 on the greataxe damage die and keeps the new face', async () => {
    const faces = [0, 0.5];
    const random = spyOn(Math, 'random').mockImplementation(() => faces.shift() ?? 0.99);
    try {
      await equip(['great_weapon_fighting'], ['Greataxe']);
      const { committed } = await attack(15);
      // Face 1 rerolls to 7. STR 16 is +3, so the hit is 10. Without the reroll it is 4.
      expect(committed.result.finalDamage).toBe(10);
    } finally {
      random.mockRestore();
    }
  });
});
