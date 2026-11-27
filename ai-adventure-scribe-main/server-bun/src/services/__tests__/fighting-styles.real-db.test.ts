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
import { and, desc, eq } from 'drizzle-orm';
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
  tacticalMaps,
} from '../../../../db/schema/index';
import { setRngSeed } from '../../lib/rng.js';

import type { TacticalMap } from '../../tactical/types.js';

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
const { resetTacticalMovementForTurn, grantTacticalDash } = await importWithRealDb(
  () => import('../combat/tactical-combat-lifecycle.js'),
);
const { consumeTacticalMapContext } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);

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
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
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
  test('#1532 refuses a second proposal after a level-1 Fighter commits an attack', async () => {
    const className = 'Fighter';
    const level = 1;
    const attacks = 1;
    await db
      .update(characters)
      .set({ class: className, level })
      .where(eq(characters.id, characterId));
    await equip([], ['Longsword']);
    const send = async (phase: 'propose' | 'commit') => {
      const expectedVersion = await version();
      return app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
          body: JSON.stringify({
            ...(phase === 'propose' ? { phase } : {}),
            intent: {
              type: 'attack',
              actorId: heroId,
              targetId,
              expectedVersion,
              ...(phase === 'commit' ? { d20: 2, actionId: testId('attack') } : {}),
            },
            origin: 'action_bar',
          }),
        }),
      );
    };
    for (let index = 0; index < attacks; index++) {
      const proposal = await send('propose');
      expect(proposal.status, await proposal.text()).toBe(200);
      const commit = await send('commit');
      expect(commit.status, await commit.text()).toBe(200);
    }
    const proposal = await send('propose');
    expect(proposal.status).toBe(422);
    expect(await proposal.json()).toMatchObject({ error: 'Action already used this turn' });

    const { armActionSurge } = await import('../combat/combat-turn-resources.js');
    await armActionSurge(sessionId, { encounterId, participantId: heroId, round: 1 });
    const surgeProposal = await send('propose');
    expect(surgeProposal.status, await surgeProposal.text()).toBe(200);
    const surgeCommit = await send('commit');
    expect(surgeCommit.status, await surgeCommit.text()).toBe(200);
    const afterSurge = await send('propose');
    expect(afterSurge.status).toBe(422);
    expect(await afterSurge.json()).toMatchObject({ error: 'Action already used this turn' });
  });

  test.each(['Fighter', 'Paladin'])(
    '#1536 level-5 %s can commit two swings before refusal',
    async (className) => {
      await db
        .update(characters)
        .set({ class: className, level: 5, classLevels: null })
        .where(eq(characters.id, characterId));
      await equip([], ['Longsword']);
      const send = async (phase: 'propose' | 'commit') =>
        app!.handle(
          new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
            body: JSON.stringify({
              ...(phase === 'propose' ? { phase } : {}),
              intent: {
                type: 'attack',
                actorId: heroId,
                targetId,
                expectedVersion: await version(),
                ...(phase === 'commit' ? { d20: 2, actionId: testId('extra-attack') } : {}),
              },
              origin: 'action_bar',
            }),
          }),
        );
      for (let swing = 0; swing < 2; swing++) {
        const proposed = await send('propose');
        expect(proposed.status, await proposed.text()).toBe(200);
        const committed = await send('commit');
        expect(committed.status, await committed.text()).toBe(200);
      }
      const exhausted = await send('propose');
      expect(exhausted.status).toBe(422);
      expect(await exhausted.json()).toMatchObject({ error: 'Action already used this turn' });
    },
  );
  test('#1536 Fighter 5 gets four swings with Action Surge', async () => {
    await db
      .update(characters)
      .set({ class: 'Fighter', level: 5, classLevels: null })
      .where(eq(characters.id, characterId));
    await equip([], ['Longsword']);
    const { armActionSurge } = await import('../combat/combat-turn-resources.js');
    await armActionSurge(sessionId, { encounterId, participantId: heroId, round: 1 });
    const send = async (phase: 'propose' | 'commit') =>
      app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
          body: JSON.stringify({
            ...(phase === 'propose' ? { phase } : {}),
            intent: {
              type: 'attack',
              actorId: heroId,
              targetId,
              expectedVersion: await version(),
              ...(phase === 'commit' ? { d20: 2, actionId: testId('surge-attack') } : {}),
            },
            origin: 'action_bar',
          }),
        }),
      );
    for (let swing = 0; swing < 4; swing++) {
      const proposed = await send('propose');
      expect(proposed.status, await proposed.text()).toBe(200);
      const committed = await send('commit');
      expect(committed.status, await committed.text()).toBe(200);
    }
    expect((await send('propose')).status).toBe(422);
  });

  test('#1536 a spent non-Attack Action grants no swing', async () => {
    await db
      .update(characters)
      .set({ class: 'Fighter', level: 5, classLevels: null })
      .where(eq(characters.id, characterId));
    await equip([], ['Longsword']);
    const dodge = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
        body: JSON.stringify({
          intent: { type: 'dodge', actorId: heroId, expectedVersion: await version() },
          origin: 'action_bar',
        }),
      }),
    );
    expect(dodge.status, await dodge.text()).toBe(200);
    const proposed = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
        body: JSON.stringify({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        }),
      }),
    );
    expect(proposed.status).toBe(422);
    expect(await proposed.json()).toMatchObject({ error: 'Action already used this turn' });
  });
  test('#1536 a failed damage write rolls back the swing', async () => {
    await db
      .update(characters)
      .set({ class: 'Fighter', level: 5, classLevels: null })
      .where(eq(characters.id, characterId));
    await equip([], ['Longsword']);
    const { CombatHPService } = await import('../combat-hp-service.js');
    const broken = spyOn(CombatHPService, 'applyDamage').mockRejectedValueOnce(
      new Error('damage write failed'),
    );
    const send = async (phase: 'propose' | 'commit') =>
      app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
          body: JSON.stringify({
            ...(phase === 'propose' ? { phase } : {}),
            intent: {
              type: 'attack',
              actorId: heroId,
              targetId,
              expectedVersion: await version(),
              ...(phase === 'commit' ? { d20: 20, actionId: testId('rollback') } : {}),
            },
            origin: 'action_bar',
          }),
        }),
      );
    try {
      expect((await send('commit')).status).toBeGreaterThanOrEqual(400);
    } finally {
      broken.mockRestore();
    }
    const proposal = await send('propose');
    expect(proposal.status, await proposal.text()).toBe(200);
    const commit = await send('commit');
    expect(commit.status, await commit.text()).toBe(200);
    const second = await send('propose');
    expect(second.status, await second.text()).toBe(200);
  });

  test('#1536 a stale session-state write cannot delete the remaining swing', async () => {
    await db
      .update(characters)
      .set({ class: 'Fighter', level: 5, classLevels: null })
      .where(eq(characters.id, characterId));
    await equip([], ['Longsword']);
    await attack(2);
    const { SessionService } = await import('../session-service.js');
    await SessionService.updateSession(sessionId, userId, { sessionState: { fixture: 'stale' } });
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
        body: JSON.stringify({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        }),
      }),
    );
    expect(response.status, await response.text()).toBe(200);
  });

  test('#1536 one commit wins the last Extra Attack swing: the other is refused, HP moves once', async () => {
    await db
      .update(characters)
      .set({ class: 'Fighter', level: 5, classLevels: null })
      .where(eq(characters.id, characterId));
    await equip([], ['Longsword']);
    // A level-5 Fighter has two swings. Spend one first so exactly one swing is left to race for.
    const sendAttack = (phase: 'propose' | 'commit', expectedVersion: number, actionId?: string) =>
      app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
          body: JSON.stringify({
            ...(phase === 'propose' ? { phase } : {}),
            intent: {
              type: 'attack',
              actorId: heroId,
              targetId,
              expectedVersion,
              ...(phase === 'commit' ? { d20: 20, actionId } : {}),
            },
            origin: 'action_bar',
          }),
        }),
      );
    const opening = await sendAttack('propose', await version());
    expect(opening.status, await opening.text()).toBe(200);
    const openingCommit = await sendAttack('commit', await version(), testId('race-open'));
    expect(openingCommit.status, await openingCommit.text()).toBe(200);
    const hpAfterOpening = (
      await db
        .select({ currentHp: combatParticipantStatus.currentHp })
        .from(combatParticipantStatus)
        .where(eq(combatParticipantStatus.participantId, targetId))
    )[0].currentHp;

    // Two proposals and two commits for the last swing, all against one shared version.
    const raceVersion = await version();
    const proposals = await Promise.all([
      sendAttack('propose', raceVersion),
      sendAttack('propose', raceVersion),
    ]);
    for (const proposal of proposals) expect(proposal.status, await proposal.text()).toBe(200);

    const settled = await Promise.all(
      [testId('race-a'), testId('race-b')].map(async (actionId) => {
        const response = await sendAttack('commit', raceVersion, actionId);
        return { status: response.status, json: (await response.json()) as Record<string, any> };
      }),
    );
    const landed = settled.filter((row) => row.status === 200);
    const refused = settled.filter((row) => row.status === 422);
    expect(landed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(['Action already used this turn', 'Combat state changed; refresh and retry']).toContain(
      refused[0].json.error,
    );

    const [target] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, targetId));
    expect(target.currentHp).toBe(hpAfterOpening - landed[0].json.result.finalDamage);
  });

  test('#1536 Fighter 5: one swing, Action Surge on a spell, the leftover swing is allowed, then refused', async () => {
    await db
      .update(characters)
      .set({ class: 'Fighter', level: 5, classLevels: null, cantrips: 'Fire Bolt' })
      .where(eq(characters.id, characterId));
    await equip([], ['Longsword']);
    const send = async (phase: 'propose' | 'commit', intent: Record<string, unknown>) => {
      const response = await app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
          body: JSON.stringify({
            ...(phase === 'propose' ? { phase } : {}),
            intent: { ...intent, expectedVersion: await version() },
            origin: 'action_bar',
          }),
        }),
      );
      return response;
    };
    const swing = (phase: 'propose' | 'commit', actionId?: string) =>
      send(phase, {
        type: 'attack',
        actorId: heroId,
        targetId,
        ...(phase === 'commit' ? { d20: 20, actionId } : {}),
      });
    const castFireBolt = (phase: 'propose' | 'commit', actionId?: string) =>
      send(phase, {
        type: 'spell',
        actorId: heroId,
        targetIds: [targetId],
        spellId: 'fire-bolt',
        spellName: 'Fire Bolt',
        ...(phase === 'commit' ? { d20: 20, actionId } : {}),
      });

    const firstProposal = await swing('propose');
    expect(firstProposal.status, await firstProposal.text()).toBe(200);
    const firstCommit = await swing('commit', testId('surge-first'));
    expect(firstCommit.status, await firstCommit.text()).toBe(200);

    const { armActionSurge, readActionSurgeMark } =
      await import('../combat/combat-turn-resources.js');
    await armActionSurge(sessionId, { encounterId, participantId: heroId, round: 1 });

    const spellProposal = await castFireBolt('propose');
    expect(spellProposal.status, await spellProposal.text()).toBe(200);
    const spellCommit = await castFireBolt('commit', testId('surge-spell'));
    expect(spellCommit.status, await spellCommit.text()).toBe(200);
    expect(await readActionSurgeMark(sessionId)).toBeNull();

    const leftoverProposal = await swing('propose');
    expect(leftoverProposal.status, await leftoverProposal.text()).toBe(200);
    const leftoverCommit = await swing('commit', testId('surge-leftover'));
    expect(leftoverCommit.status, await leftoverCommit.text()).toBe(200);

    const refused = await swing('propose');
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ error: 'Action already used this turn' });
  });

  test('#1802 a second out-of-reach melee proposal does not move again and appends no second DM fact', async () => {
    await equip([], ['Longsword']);
    // A long movement-blocking obstacle (#1057's feast table): the hero closes to 15 ft on
    // the first proposal but cannot reach the foe, and the detour around the table's end
    // costs 45 ft against 30 ft of movement — so without the fix a second proposal walks
    // the detour again and appends a second fact. The fixture follows the producers the
    // route already reads: the tactical map row (`tacticalMaps.state`), the equipped
    // `inventory_items` row, and the encounter version the route checks.
    const mapId = crypto.randomUUID();
    const width = 9;
    const height = 11;
    const cells = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        if (x === 4 && y <= 8) {
          return {
            terrain: 'wall' as const,
            blocksMovement: true,
            blocksSight: true,
            cover: 3 as const,
            elevation: 0,
            decoration: 'long feast table',
          };
        }
        return {
          terrain: 'floor' as const,
          blocksMovement: false,
          blocksSight: false,
          cover: 0 as const,
          elevation: 0,
        };
      }),
    );
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width,
        height,
        cells,
        entities: [
          {
            id: heroId,
            x: 2,
            y: 4,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 6,
            y: 4,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 repeat proposal fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 5, distanceFeet: 15 },
      });
      const afterFirst = await readMap();
      const heroAfterFirst = afterFirst.entities.find((entity) => entity.id === heroId)!;
      expect(heroAfterFirst.movementRemaining).toBe(25);
      expect(afterFirst.pendingDmFacts).toHaveLength(1);
      expect(afterFirst.pendingDmFacts![0]).toContain('could not reach');
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);

      const second = await propose();
      expect(second.proposal).toMatchObject({
        movementOnly: true,
        result: {
          resolvedAs: 'movement_only',
          movedFeet: 0,
          from: { x: heroAfterFirst.x, y: heroAfterFirst.y },
          to: { x: heroAfterFirst.x, y: heroAfterFirst.y },
          distanceFeet: 15,
          startingDistanceFeet: 15,
        },
      });
      const afterSecond = await readMap();
      const heroAfterSecond = afterSecond.entities.find((entity) => entity.id === heroId)!;
      expect({ x: heroAfterSecond.x, y: heroAfterSecond.y }).toEqual({
        x: heroAfterFirst.x,
        y: heroAfterFirst.y,
      });
      expect(heroAfterSecond.movementRemaining).toBe(25);
      expect(afterSecond.pendingDmFacts).toHaveLength(1);
      expect(afterSecond.pendingDmFacts![0]).toBe(afterFirst.pendingDmFacts![0]);
      expect(afterSecond.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);

      // Next turn: the movement reset clears the marker, so the same attack is a fresh
      // resolution — it moves again (the detour remainder) and records a second fact
      // for the new attempt. If the marker had not cleared, propose 3 would come back
      // movedFeet 0 with still one fact.
      await resetTacticalMovementForTurn(sessionId, heroId);
      const third = await propose();
      expect(third.proposal).toMatchObject({
        movementOnly: true,
        result: {
          resolvedAs: 'movement_only',
          movedFeet: 30,
          from: { x: heroAfterFirst.x, y: heroAfterFirst.y },
          to: { x: 4, y: 9 },
          distanceFeet: 25,
        },
      });
      const afterThird = await readMap();
      const heroAfterThird = afterThird.entities.find((entity) => entity.id === heroId)!;
      expect(heroAfterThird.movementRemaining).toBe(0);
      expect(afterThird.pendingDmFacts).toHaveLength(2);
      expect(afterThird.pendingDmFacts![1]).toContain('could not reach');
      expect(afterThird.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 30 },
      ]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  });

  // Shared by the two #1802 cage tests below: the hero at (3,1) with all 8 neighbors
  // wall (the unit-test shape from combat-approach-service), the target at (1,1) two
  // cells away. The hero cannot move at all, so the first proposal spends nothing.
  function cagedCells(): Array<Array<Record<string, unknown>>> {
    const wall = {
      terrain: 'wall' as const,
      blocksMovement: true,
      blocksSight: true,
      cover: 3 as const,
      elevation: 0,
      decoration: 'cage wall',
    };
    const floor = {
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    };
    return Array.from({ length: 11 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) => {
        const caged = Math.abs(x - 3) <= 1 && Math.abs(y - 1) <= 1 && !(x === 3 && y === 1);
        return caged ? { ...wall } : { ...floor };
      }),
    );
  }

  test('#1802 (fall-through) a 0-spent resolution re-plans once the board changes', async () => {
    await equip([], ['Longsword']);
    // The first proposal spends nothing (caged, movedFeet 0). Clearing the cell toward
    // the target is a board change: the repeat re-plans, finds a reaching cell, and
    // moves once instead of reusing the refusal — and records no second fact.
    const mapId = crypto.randomUUID();
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width: 9,
        height: 11,
        cells: cagedCells(),
        entities: [
          {
            id: heroId,
            x: 3,
            y: 1,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 1,
            y: 1,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 0,
            movementRemaining: 0,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 fall-through fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 0, distanceFeet: 10 },
      });
      const afterFirst = await readMap();
      expect(afterFirst.entities.find((entity) => entity.id === heroId)).toMatchObject({
        x: 3,
        y: 1,
        movementRemaining: 30,
      });
      expect(afterFirst.pendingDmFacts).toHaveLength(1);
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 0 },
      ]);

      // The board changes: the wall between hero and target comes down.
      const [row] = await db
        .select({ state: tacticalMaps.state })
        .from(tacticalMaps)
        .where(eq(tacticalMaps.id, mapId));
      const state = row!.state as TacticalMap;
      state.cells[1][2] = {
        terrain: 'floor',
        blocksMovement: false,
        blocksSight: false,
        cover: 0,
        elevation: 0,
      };
      await db.update(tacticalMaps).set({ state }).where(eq(tacticalMaps.id, mapId));

      const second = await propose();
      expect(second.proposal.movementOnly).toBe(false);
      const afterSecond = await readMap();
      expect(afterSecond.entities.find((entity) => entity.id === heroId)).toMatchObject({
        x: 2,
        y: 1,
        movementRemaining: 25,
      });
      expect(afterSecond.pendingDmFacts).toHaveLength(1);
      expect(afterSecond.pendingDmFacts![0]).toBe(afterFirst.pendingDmFacts![0]);
      expect(afterSecond.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 5 },
      ]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  });

  test('#1802 (Dash) a Dash after a failed approach clears the marker', async () => {
    await equip([], ['Longsword']);
    // Open board, 55 ft apart: the first proposal walks 30 ft and still cannot reach.
    // The Dash is invoked directly — grantTacticalDash is what the route's Dash intent
    // calls, and the clearing lives there (the route wiring is covered by the
    // dash-intent suite; the fixture hero is a Fighter, so Cunning Action is not
    // available to exercise the bonus-action path end to end here).
    const mapId = crypto.randomUUID();
    const floorCell = {
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    };
    await db.insert(tacticalMaps).values({
      id: mapId,
      sessionId,
      state: {
        id: mapId,
        sessionId,
        width: 13,
        height: 3,
        cells: Array.from({ length: 3 }, () =>
          Array.from({ length: 13 }, () => ({ ...floorCell })),
        ),
        entities: [
          {
            id: heroId,
            x: 0,
            y: 1,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Bram',
          },
          {
            id: targetId,
            x: 11,
            y: 1,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 30,
            movementRemaining: 30,
            name: 'Practice Dummy',
          },
        ],
        round: 1,
        sceneDescription: '1802 dash fixture',
      },
      active: true,
    });
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readMap = async (): Promise<MapState> => {
        const [row] = await db
          .select({ state: tacticalMaps.state })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt))
          .limit(1);
        return row!.state as MapState;
      };

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 30, distanceFeet: 25 },
      });
      const afterFirst = await readMap();
      expect(afterFirst.entities.find((entity) => entity.id === heroId)).toMatchObject({
        x: 6,
        y: 0,
        movementRemaining: 0,
      });
      expect(afterFirst.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 30 },
      ]);

      await grantTacticalDash(sessionId, heroId);
      const afterDash = await readMap();
      expect(afterDash.entities.find((entity) => entity.id === heroId)?.movementRemaining).toBe(30);
      expect(afterDash.resolvedUnreachableApproaches ?? []).toEqual([]);

      // Fresh movement is a fresh approach: the re-proposal closes and rolls.
      const second = await propose();
      expect(second.proposal.movementOnly).toBe(false);
      const afterSecond = await readMap();
      const heroAfterSecond = afterSecond.entities.find((entity) => entity.id === heroId)!;
      expect(Math.max(Math.abs(heroAfterSecond.x - 11), Math.abs(heroAfterSecond.y - 1))).toBe(1);
      expect(heroAfterSecond.movementRemaining).toBe(10);
      expect(afterSecond.pendingDmFacts).toHaveLength(1);
      expect(afterSecond.resolvedUnreachableApproaches ?? []).toEqual([]);
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  });

  test('#1802 (divergent rows) the fact lands on the latest row and the marker on the active row', async () => {
    await equip([], ['Longsword']);
    // Two rows for the session: the active board (caged hero, old updatedAt) and a newer
    // torn-down board (latest by updatedAt, inactive). The first proposal spends nothing
    // (caged, movedFeet 0), so the only writes are the fact and the marker — which is
    // what makes the updatedAt assertions deterministic: no move bumps the active row.
    const mapId = crypto.randomUUID();
    const decoyId = crypto.randomUUID();
    const oldTime = new Date(Date.now() - 3600_000);
    const floorCell = {
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    };
    await db.insert(tacticalMaps).values([
      {
        id: mapId,
        sessionId,
        state: {
          id: mapId,
          sessionId,
          width: 9,
          height: 11,
          cells: cagedCells(),
          entities: [
            {
              id: heroId,
              x: 3,
              y: 1,
              size: 'medium' as const,
              type: 'pc' as const,
              speedFeet: 30,
              movementRemaining: 30,
              name: 'Bram',
            },
            {
              id: targetId,
              x: 1,
              y: 1,
              size: 'medium' as const,
              type: 'monster' as const,
              speedFeet: 0,
              movementRemaining: 0,
              name: 'Practice Dummy',
            },
          ],
          round: 1,
          sceneDescription: '1802 divergent fixture',
        },
        active: true,
        updatedAt: oldTime,
      },
      {
        id: decoyId,
        sessionId,
        state: {
          id: decoyId,
          sessionId,
          width: 3,
          height: 3,
          cells: Array.from({ length: 3 }, () =>
            Array.from({ length: 3 }, () => ({ ...floorCell })),
          ),
          entities: [],
          round: 1,
          sceneDescription: 'torn-down board',
        },
        active: false,
        updatedAt: new Date(),
      },
    ]);
    try {
      type MapState = {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
        pendingDmFacts?: string[];
        resolvedUnreachableApproaches?: Array<{
          actorId: string;
          targetId: string;
          movedFeet: number;
        }>;
      };
      const propose = async (): Promise<Record<string, any>> =>
        post({
          phase: 'propose',
          intent: { type: 'attack', actorId: heroId, targetId, expectedVersion: await version() },
          origin: 'action_bar',
        });
      const readRows = async (): Promise<
        Array<{ id: string; state: MapState; active: boolean; updatedAt: Date }>
      > => {
        const rows = await db
          .select({
            id: tacticalMaps.id,
            state: tacticalMaps.state,
            active: tacticalMaps.active,
            updatedAt: tacticalMaps.updatedAt,
          })
          .from(tacticalMaps)
          .where(eq(tacticalMaps.sessionId, sessionId))
          .orderBy(desc(tacticalMaps.updatedAt));
        return rows as Array<{ id: string; state: MapState; active: boolean; updatedAt: Date }>;
      };

      const before = await readRows();
      expect(before).toHaveLength(2);
      expect(before[0]!.id).toBe(decoyId);
      expect(before[1]!.id).toBe(mapId);

      const first = await propose();
      expect(first.proposal).toMatchObject({
        movementOnly: true,
        result: { resolvedAs: 'movement_only', movedFeet: 0, distanceFeet: 10 },
      });

      const after = await readRows();
      const activeRow = after.find((row) => row.id === mapId)!;
      const latestRow = after.find((row) => row.id === decoyId)!;
      // The marker write is state-only (no updatedAt bump): the active row is untouched
      // and the fact row stays strictly newest, so "latest" can never flip to the
      // active row and strand the fact.
      expect(activeRow.updatedAt.getTime()).toBe(before[1]!.updatedAt.getTime());
      expect(latestRow.updatedAt.getTime()).toBeGreaterThan(before[0]!.updatedAt.getTime());
      expect(latestRow.updatedAt.getTime()).toBeGreaterThan(activeRow.updatedAt.getTime());
      expect(latestRow.state.pendingDmFacts).toHaveLength(1);
      expect(latestRow.state.pendingDmFacts![0]).toContain('could not reach');
      expect(latestRow.state.resolvedUnreachableApproaches ?? []).toEqual([]);
      expect(activeRow.state.resolvedUnreachableApproaches).toEqual([
        { actorId: heroId, targetId, movedFeet: 0 },
      ]);
      expect(activeRow.state.pendingDmFacts ?? []).toEqual([]);

      // The fact is deliverable, not stranded: consume reads the latest row.
      const delivered = await consumeTacticalMapContext(sessionId);
      expect(delivered.facts).toEqual(
        expect.arrayContaining([expect.stringContaining('could not reach')]),
      );
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
  });
});
