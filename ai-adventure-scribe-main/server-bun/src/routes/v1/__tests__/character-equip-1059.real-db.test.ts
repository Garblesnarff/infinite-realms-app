/**
 * #1059: there is no way to equip a weapon in-session (Hark N23-008/009).
 *
 * Sera Voss's shortbow sat in her in-session inventory as inert text: the DM
 * accepted "I draw my shortbow" in prose and the engine still refused the
 * attack — 'Shortbow is not equipped'. The Fighter's light crossbow shipped
 * unequipped from the package the same way.
 *
 * This suite pins the three ends of the fix through the real routes:
 *  - the attack picker offers a carried-but-unequipped ranged weapon as an
 *    'Equip and attack' choice while a melee weapon holds the main hand;
 *  - POST /v1/characters/:id/equip/:itemId (the in-session Equip control's
 *    route) equips it, persisted on the same character_equipment rows the
 *    sheet and the combat readers read, and the next attack resolves with
 *    the newly equipped weapon;
 *  - at create, a package's main ranged weapon is equipped when no melee
 *    weapon is equipped in the main hand.
 *
 * On main every equip assertion below fails: the picker offers no
 * equip-and-attack choice, the equip route does not exist (404), and the
 * create pass leaves the shortbow carried in the pre-equipped-off-hand shape.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  campaigns,
  characterEquipment,
  characters,
  characterStats,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.ts';

// Same logger stub the other character-route real-DB suites use.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let userId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'user@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
  default: stub(),
}));

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../../../../../shared/test-fixtures/${name}`),
      'utf8',
    ),
  ) as Record<string, unknown>;

// #971's pinned wizard payloads: the Criminal Rogue (Leather Armor, Dagger x2,
// Thieves' Tools, Shortbow, Arrows) and the Hill Dwarf Fighter (Chain Mail,
// Shield, Longsword, Handaxe x2, Crossbow light, Bolts) — Hark's two cases.
const criminalRoguePayload = fixture('criminal-rogue-create-payload.json');
const fighterPayload = fixture('hill-dwarf-fighter-create-payload.json');

type IntentOutcome = {
  weaponResolution?: { resolved?: string; substituted?: boolean };
};

type LegalAction = {
  type: string;
  label?: string;
  weaponId?: string;
  equipFirst?: boolean;
};

describeWithDb('in-session weapon equip (#1059)', () => {
  let app: { handle: (request: Request) => Promise<Response> };
  let db: ReturnType<typeof realDb>;
  let executeCombatIntent: (
    encounterId: string,
    intent: unknown,
    userId: string,
    source: string,
  ) => Promise<IntentOutcome>;
  let getLegalCombatActions: (
    encounterId: string,
    userId: string,
  ) => Promise<{ actions: LegalAction[] }>;
  const cleanup: Array<() => Promise<unknown>> = [];

  beforeAll(async () => {
    userId = testId('user-1059');
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.ts');
      const { charactersRoutes } = await import('../characters.ts');
      const { inventoryRoutes } = await import('../inventory.ts');
      const { issue1784DataRoutes } = await import('../issue-1784-data.ts');
      const intentService = await import('../../../services/combat/combat-intent-service.ts');
      return { createRequestPipelineApp, charactersRoutes, inventoryRoutes, issue1784DataRoutes, intentService };
    });
    app = pipeline
      .createRequestPipelineApp()
      .use(pipeline.charactersRoutes)
      .use(pipeline.inventoryRoutes)
      .use(pipeline.issue1784DataRoutes);
    executeCombatIntent = pipeline.intentService.executeCombatIntent as typeof executeCombatIntent;
    getLegalCombatActions = pipeline.intentService
      .getLegalCombatActions as unknown as typeof getLegalCombatActions;
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => {});
    await closeRealDb();
  });

  async function create(body: Record<string, unknown>): Promise<string> {
    const res = await app.handle(
      new Request('http://localhost/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    cleanup.push(async () => db.delete(characters).where(eq(characters.id, id)));
    return id;
  }

  type EquipmentRow = { item_name: string; equipped: boolean; quantity: number };

  async function equipmentRows(id: string): Promise<EquipmentRow[]> {
    const res = await app.handle(new Request(`http://localhost/v1/characters/${id}/equipment`));
    expect(res.status).toBe(200);
    return (await res.json()) as EquipmentRow[];
  }

  /** The exact request the in-session Equip control sends (path params only, no body). */
  async function equip(id: string, itemToken: string): Promise<Response> {
    return app.handle(
      new Request(`http://localhost/v1/characters/${id}/equip/${encodeURIComponent(itemToken)}`, {
        method: 'POST',
      }),
    );
  }

  /** Seat the character in a real encounter and return the ids the intent service needs. */
  async function seat(
    characterId: string,
  ): Promise<{ encounterId: string; heroId: string; foeId: string }> {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp-1059') })
      .returning({ id: campaigns.id });
    cleanup.push(async () => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    cleanup.push(async () => db.delete(gameSessions).where(eq(gameSessions.id, sessionId)));
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    cleanup.push(async () => db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId)));
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Session Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 14,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          name: 'Session Foe',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    const heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    const foeId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: foeId, currentHp: 30, maxHp: 30, isConscious: true },
    ]);
    cleanup.push(async () =>
      db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId)),
    );
    return { encounterId, heroId, foeId };
  }

  async function resetTurn(encounterId: string): Promise<void> {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId));
  }

  async function legalActions(encounterId: string): Promise<LegalAction[]> {
    const legal = await getLegalCombatActions(encounterId, userId);
    return legal.actions;
  }

  async function attackLabels(encounterId: string): Promise<string[]> {
    return (await legalActions(encounterId))
      .filter((a) => a.type === 'attack')
      .map((a) => a.label ?? '');
  }

  it('rogue: the picker offers equip-and-attack for the shortbow, the equip route equips it, and the next attack resolves with it', async () => {
    const id = await create({ ...criminalRoguePayload, name: testId('sera-1059') });

    // Create leaves the melee Dagger in the main hand; the Shortbow is carried.
    const rows = await equipmentRows(id);
    expect(rows.find((row) => row.item_name === 'Shortbow')?.equipped).toBe(false);

    const { encounterId, heroId, foeId } = await seat(id);

    // The picker offers the equipped Dagger as a plain attack and the carried
    // Shortbow as an equip-and-attack choice (item 3's 'otherwise' branch).
    const before = await legalActions(encounterId);
    const labels = before.filter((a) => a.type === 'attack').map((a) => a.label ?? '');
    expect(labels).toContain('Attack with Dagger');
    expect(labels).toContain('Equip and attack with Shortbow');
    const equipChoice = before.find((a) => a.label === 'Equip and attack with Shortbow');
    expect(equipChoice?.equipFirst).toBe(true);
    expect(equipChoice?.weaponId).toBeTruthy();

    // Precondition, Hark's refusal: a shortbow attack before equipping is refused.
    await resetTurn(encounterId);
    let refusal = '';
    try {
      await executeCombatIntent(
        encounterId,
        { type: 'attack', actorId: heroId, targetId: foeId, weaponId: 'Shortbow' },
        userId,
        'dm',
      );
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    expect(refusal).toContain('not equipped');

    // The in-session equip (item 2's route) persists on the sheet's rows.
    const equipRes = await equip(id, 'Shortbow');
    expect(equipRes.status, await equipRes.clone().text()).toBe(200);
    const equipBody = (await equipRes.json()) as { success?: boolean };
    expect(equipBody.success).toBe(true);
    const after = await equipmentRows(id);
    expect(after.find((row) => row.item_name === 'Shortbow')?.equipped).toBe(true);

    // The picker now offers the Shortbow as a plain attack, and the attack
    // resolves with the newly equipped weapon.
    expect(await attackLabels(encounterId)).toContain('Attack with Shortbow');
    expect(await attackLabels(encounterId)).not.toContain('Equip and attack with Shortbow');
    await resetTurn(encounterId);
    const outcome = await executeCombatIntent(
      encounterId,
      { type: 'attack', actorId: heroId, targetId: foeId, weaponId: 'Shortbow' },
      userId,
      'dm',
    );
    expect(outcome.weaponResolution?.resolved).toBe('Shortbow');
    expect(outcome.weaponResolution?.substituted).toBe(false);
  });

  it('fighter: the package light crossbow is offered as equip-and-attack and equips by the picker\u2019s row id', async () => {
    const id = await create({ ...fighterPayload, name: testId('fighter-1059') });

    const rows = await equipmentRows(id);
    expect(rows.find((row) => row.item_name === 'Crossbow, light')?.equipped).toBe(false);
    expect(rows.find((row) => row.item_name === 'Longsword')?.equipped).toBe(true);

    const { encounterId } = await seat(id);
    const offered = (await legalActions(encounterId)).find(
      (a) => a.label === 'Equip and attack with Crossbow, light',
    );
    expect(offered?.equipFirst).toBe(true);
    expect(offered?.weaponId).toBeTruthy();

    // The token the client actually sends for this choice is the weapon
    // profile's row id, not the name — the route resolves it the same way.
    const equipRes = await equip(id, offered!.weaponId!);
    expect(equipRes.status, await equipRes.clone().text()).toBe(200);
    const after = await equipmentRows(id);
    expect(after.find((row) => row.item_name === 'Crossbow, light')?.equipped).toBe(true);
    expect(await attackLabels(encounterId)).toContain('Attack with Crossbow, light');
  });

  it('equip route: a weapon the character does not carry is a 404, and another user\u2019s character is not equippable', async () => {
    const id = await create({ ...criminalRoguePayload, name: testId('guard-1059') });
    const missing = await equip(id, 'Greataxe');
    expect(missing.status).toBe(404);

    // The ownership join: the same request under another user's id finds no
    // item, so one player can never equip (or probe) another's gear.
    const ownerId = userId;
    userId = testId('other-1059');
    try {
      const foreign = await equip(id, 'Shortbow');
      expect(foreign.status).toBe(404);
    } finally {
      userId = ownerId;
    }
    const rows = await equipmentRows(id);
    expect(rows.find((row) => row.item_name === 'Shortbow')?.equipped).toBe(false);
  });

  it('create: the main ranged weapon is equipped when no melee weapon is equipped in the main hand', async () => {
    // The package shape the plain create pass leaves bare: the caller already
    // marked an off-hand ranged weapon equipped (a hand crossbow), which
    // spends the pass's one weapon slot, so neither the Dagger (melee) nor
    // the package's main ranged weapon (the Shortbow) arrives equipped.
    const payload = {
      ...criminalRoguePayload,
      equipment: [
        ...(criminalRoguePayload.equipment as Array<Record<string, unknown>>),
        {
          character_id: '00000000-0000-0000-0000-000000000000',
          item_name: 'Hand Crossbow',
          item_type: 'equipment',
          quantity: 1,
          equipped: true,
          is_magic: false,
          magic_bonus: 0,
          magic_properties: null,
          requires_attunement: false,
          is_attuned: false,
          attunement_requirements: null,
          magic_item_type: null,
          magic_item_rarity: 'common',
          magic_effects: null,
        },
      ],
    };
    const id = await create({ ...payload, name: testId('ranged-create-1059') });
    const rows = await equipmentRows(id);
    expect(rows.find((row) => row.item_name === 'Dagger')?.equipped).toBe(false);
    expect(rows.find((row) => row.item_name === 'Shortbow')?.equipped).toBe(true);
  });

  it('equip route: an inventory_items-only grant (no sheet row) equips and is offered as a plain attack', async () => {
    const id = await create({ ...criminalRoguePayload, name: testId('grant-1059') });
    // A story grant lands in inventory_items only — no character_equipment row.
    await realDb().insert(inventoryItems).values({
      characterId: id,
      name: 'Longbow',
      itemType: 'weapon',
      quantity: 1,
    });
    const { encounterId } = await seat(id);
    const equipRes = await equip(id, 'Longbow');
    expect(equipRes.status, await equipRes.clone().text()).toBe(200);
    const [row] = await realDb()
      .select({ isEquipped: inventoryItems.isEquipped })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.characterId, id), eq(inventoryItems.name, 'Longbow')));
    expect(row?.isEquipped).toBe(true);
    expect(await attackLabels(encounterId)).toContain('Attack with Longbow');
  });

  it('equip route: donning the shield re-syncs the stored armor class (#1858)', async () => {
    const id = await create({ ...fighterPayload, name: testId('shield-1059') });
    const [worn] = await realDb()
      .select({ armorClass: characterStats.armorClass })
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    const acWithShield = worn?.armorClass ?? 0;
    expect(acWithShield).toBeGreaterThan(0);

    // The state the old world left behind: shield carried, stored AC without it.
    await realDb()
      .update(characterEquipment)
      .set({ equipped: false })
      .where(
        and(eq(characterEquipment.characterId, id), eq(characterEquipment.itemName, 'Shield')),
      );
    await realDb()
      .update(inventoryItems)
      .set({ isEquipped: false })
      .where(and(eq(inventoryItems.characterId, id), eq(inventoryItems.name, 'Shield')));
    await realDb()
      .update(characterStats)
      .set({ armorClass: acWithShield - 2 })
      .where(eq(characterStats.characterId, id));

    const equipRes = await equip(id, 'Shield');
    expect(equipRes.status, await equipRes.clone().text()).toBe(200);
    const body = (await equipRes.json()) as { armorClass?: number | null };
    expect(body.armorClass).toBe(acWithShield);
    const [afterStats] = await realDb()
      .select({ armorClass: characterStats.armorClass })
      .from(characterStats)
      .where(eq(characterStats.characterId, id));
    expect(afterStats?.armorClass).toBe(acWithShield);
  });

  it('picker: a carried row spelled in display order is not offered when the catalog spelling is equipped', async () => {
    const id = await create({ ...fighterPayload, name: testId('spelling-1059') });
    await realDb()
      .update(characterEquipment)
      .set({ equipped: true })
      .where(
        and(
          eq(characterEquipment.characterId, id),
          eq(characterEquipment.itemName, 'Crossbow, light'),
        ),
      );
    // A second row for the same weapon under its display-order spelling.
    await realDb().insert(inventoryItems).values({
      characterId: id,
      name: 'Light Crossbow',
      itemType: 'weapon',
      quantity: 1,
    });
    const { encounterId } = await seat(id);
    const labels = await attackLabels(encounterId);
    expect(labels).toContain('Attack with Crossbow, light');
    expect(labels).not.toContain('Equip and attack with Light Crossbow');
    expect(labels).not.toContain('Equip and attack with Crossbow, light');
  });

  it('picker: a ranged weapon with no ammunition is not offered as equip-and-attack', async () => {
    const id = await create({ ...criminalRoguePayload, name: testId('noammo-1059') });
    await realDb()
      .delete(characterEquipment)
      .where(
        and(eq(characterEquipment.characterId, id), eq(characterEquipment.itemName, 'Arrows (20)')),
      );
    await realDb()
      .delete(inventoryItems)
      .where(and(eq(inventoryItems.characterId, id), eq(inventoryItems.name, 'Arrows (20)')));
    const { encounterId } = await seat(id);
    const labels = await attackLabels(encounterId);
    expect(labels).toContain('Attack with Dagger');
    expect(labels).not.toContain('Equip and attack with Shortbow');
  });
});
