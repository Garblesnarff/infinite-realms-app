/**
 * #206 (M4): WorkOS environment switch — account re-link in the auth callback.
 *
 * `users.id` is the WorkOS user id. When prod moves from the staging WorkOS
 * environment to the production one, every returning user arrives with a NEW
 * WorkOS id while their rows still carry the old one. The callback must
 * re-link: if no `users` row has the new id but exactly one row has the
 * verified email WorkOS returned, that row and every row it owns move to the
 * new id in one transaction. More than one match, or an unverified email,
 * moves nothing. Neither does a match whose old id still resolves as a
 * live user in the WorkOS stub (the takeover guard). A liveness check
 * that errors, or a move that throws mid-transaction, additionally
 * creates NO fresh users row — the account is never sealed behind the
 * new id, and a later sign-in retries the re-link.
 *
 * #1040 hardening, same suite: an unverified sign-in creates NO users row
 * (a row materialised for an address the signer never verified would sit
 * beside the real owner's row and block their re-link as "ambiguous"
 * forever); and the takeover guard accepts only the WorkOS SDK's
 * NotFoundException as proof the old id is gone — a bare status-404 error
 * is liveness unknown, with the same no-move/no-row/retry behaviour as any
 * other liveness failure.
 *
 * Every request goes through the real auth routes mounted on
 * `createRequestPipelineApp` against real PostgreSQL; only the WorkOS client
 * is stubbed (WorkOS cannot be reached from a test). The stub returns the
 * exact shape `authenticateWithCode` resolves in production
 * (`{ user, accessToken, refreshToken }`, user carrying `emailVerified`).
 *
 * On main there is no re-link: the first case fails there — the old row and
 * its campaigns stay on the old id and a fresh empty account is created.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  aiUsage,
  campaigns,
  characterFolders,
  characterPermissions,
  characters,
  feedback,
  fogOfWar,
  gameSessions,
  measurementTemplates,
  memoryExtractionJobs,
  sceneDrawings,
  scenes,
  sessionChronicles,
  users,
  visionBlockingShapes,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8899';
  process.env.NODE_ENV ??= 'test';
}

/** The WorkOS user the next callback sign-in resolves as; set per case. */
let stubbedUser: Record<string, unknown> | null = null;

/**
 * How the stub's `getUser` (the re-link takeover guard's liveness check)
 * answers for the next case: the old id is gone from the environment
 * ('not-found', the cutover shape), still a live user ('live'), the check
 * itself fails ('error'), or it fails with a status-404 error that is NOT
 * the SDK's NotFoundException ('bare-404', #1040).
 */
let stubbedGetUserMode: 'not-found' | 'live' | 'error' | 'bare-404' = 'not-found';

mock.module('../../../services/workos.ts', () => ({
  workos: {
    userManagement: {
      authenticateWithCode: async () => {
        if (!stubbedUser) throw new Error('test bug: no stubbed WorkOS user');
        return { user: stubbedUser, accessToken: 'stub-access', refreshToken: 'stub-refresh' };
      },
      authenticateWithRefreshToken: async () => ({
        accessToken: 'stub-access',
        refreshToken: 'stub-refresh',
      }),
      getUser: async (id: string) => {
        if (stubbedGetUserMode === 'live') return { id, emailVerified: true };
        if (stubbedGetUserMode === 'error') {
          throw Object.assign(new Error('WorkOS unavailable'), { name: 'APIError', status: 500 });
        }
        if (stubbedGetUserMode === 'bare-404') {
          throw Object.assign(new Error('404 from a non-SDK layer'), {
            name: 'APIError',
            status: 404,
          });
        }
        throw Object.assign(new Error('User not found'), { name: 'NotFoundException', status: 404 });
      },
      getAuthorizationUrl: () => 'https://auth.example.test/authorize',
      getLogoutUrl: () => 'https://auth.example.test/logout',
    },
  },
  authConfig: { clientId: 'test-workos-client-id', redirectUri: 'http://localhost/auth/callback' },
  verifyWorkOSToken: async () => null,
}));

await importWithRealDb(() => import('../../../lib/drizzle.js'));
const { createRequestPipelineApp } = await importWithRealDb(() => import('../../../http-pipeline.js'));
const { authRoutes } = await importWithRealDb(() => import('../auth.js'));

const app = hasRealDb ? createRequestPipelineApp().use(authRoutes) : null;

const seededUserIds: string[] = [];
const seededCampaignIds: string[] = [];

async function seedUser(id: string, email: string, plan = 'free'): Promise<void> {
  seededUserIds.push(id);
  await realDb().insert(users).values({ id, email, plan, firstName: 'Seed', lastName: 'User' });
}

async function seedCampaign(userId: string): Promise<string> {
  const [row] = await realDb()
    .insert(campaigns)
    .values({ userId, name: `Campaign ${testId('c')}` })
    .returning({ id: campaigns.id });
  seededCampaignIds.push(row.id);
  return row.id;
}

async function signIn(
  user: Record<string, unknown>,
  getUserMode: 'not-found' | 'live' | 'error' | 'bare-404' = 'not-found',
): Promise<Response> {
  if (!app) throw new Error('signIn called without a database-backed app');
  stubbedUser = user;
  stubbedGetUserMode = getUserMode;
  const state = `state-${testId('s')}`;
  return app.handle(
    new Request(`http://localhost/v1/auth/callback?code=stub-code&state=${state}`, {
      headers: { cookie: `ir_oauth_state=${state}` },
    }),
  );
}

function expectSuccessfulSignIn(res: Response): void {
  expect(res.status).toBe(302);
  // The callback's failure path also 302s (to /?error=auth_failed); only the
  // success path redirects to the token-exchange callback. Asserting the
  // location keeps the negative cases from passing on a failed sign-in.
  expect(res.headers.get('location')).toContain('/auth/callback?code=');
}

async function userRow(id: string): Promise<typeof users.$inferSelect | null> {
  const rows = await realDb().select().from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}

async function campaignsOf(userId: string): Promise<(typeof campaigns.$inferSelect)[]> {
  return realDb().select().from(campaigns).where(eq(campaigns.userId, userId));
}

describeWithDb('#206 WorkOS re-link in the auth callback', () => {
  afterAll(async () => {
    if (hasRealDb) {
      // User-keyed rows first; the rest cascade from characters/campaigns.
      await realDb().delete(aiUsage).where(inArray(aiUsage.userId, seededUserIds));
      await realDb().delete(sessionChronicles).where(inArray(sessionChronicles.userId, seededUserIds));
      await realDb()
        .delete(memoryExtractionJobs)
        .where(inArray(memoryExtractionJobs.userId, seededUserIds));
      await realDb().delete(characterFolders).where(inArray(characterFolders.userId, seededUserIds));
      await realDb().delete(feedback).where(inArray(feedback.userId, seededUserIds));
      await realDb().delete(characters).where(inArray(characters.userId, seededUserIds));
      await realDb().delete(campaigns).where(inArray(campaigns.userId, seededUserIds));
      await realDb().delete(users).where(inArray(users.id, seededUserIds));
    }
    await closeRealDb();
  });

  test('a single verified-email match moves the account and everything it owns to the new id', async () => {
    const oldId = testId('user-old');
    const newId = testId('user-new');
    seededUserIds.push(newId);
    const email = `${testId('relink')}@example.test`;
    await seedUser(oldId, email, 'pro');
    await seedCampaign(oldId);
    await seedCampaign(oldId);
    const [character] = await realDb()
      .insert(characters)
      .values({ userId: oldId, ownerId: oldId, name: 'Relink Hero' })
      .returning({ id: characters.id });
    await realDb()
      .insert(aiUsage)
      .values({ userId: oldId, type: 'llm', units: 3, periodStart: new Date() });

    // One row per remaining (table, column) in the owned-row census, so a
    // dropped or mistyped move in the service fails this case: chronicles,
    // permissions (both columns), folders, feedback, extraction jobs, and
    // the scene family (scene, fog, vision shapes, drawings, templates).
    const [campaignRow] = await realDb()
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.userId, oldId))
      .limit(1);
    const [session] = await realDb()
      .insert(gameSessions)
      .values({ campaignId: campaignRow.id })
      .returning({ id: gameSessions.id });
    await realDb()
      .insert(sessionChronicles)
      .values({ sessionId: session.id, userId: oldId, status: 'ready' });
    // Two permission rows with the columns split, so a move whose WHERE
    // clause swapped userId/grantedBy could not pass: row one is the old
    // user's own grant (userId moves, grantedBy must not), row two is a
    // grant BY the old user to someone else (grantedBy moves, userId not).
    const otherId = testId('user-other-party');
    await realDb().insert(characterPermissions).values({
      characterId: character.id,
      userId: oldId,
      grantedBy: otherId,
    });
    await realDb().insert(characterPermissions).values({
      characterId: character.id,
      userId: otherId,
      grantedBy: oldId,
    });
    await realDb().insert(characterFolders).values({ userId: oldId, name: 'Heroes' });
    await realDb()
      .insert(feedback)
      .values({ userId: oldId, message: 'great', page: '/app' });
    await realDb().insert(memoryExtractionJobs).values({
      id: crypto.randomUUID(),
      userId: oldId,
      plan: 'free',
      sessionId: session.id,
      kind: 'session',
      prompt: 'extract',
      payloadHash: 'hash',
      maxTokens: 100,
    });
    const [scene] = await realDb()
      .insert(scenes)
      .values({ name: 'Cave', campaignId: campaignRow.id, userId: oldId, width: 10, height: 10 })
      .returning({ id: scenes.id });
    await realDb().insert(fogOfWar).values({ sceneId: scene.id, userId: oldId });
    await realDb().insert(visionBlockingShapes).values({
      sceneId: scene.id,
      shapeType: 'wall',
      pointsData: [{ x: 0, y: 0 }],
      createdBy: oldId,
    });
    await realDb().insert(sceneDrawings).values({
      sceneId: scene.id,
      createdBy: oldId,
      drawingType: 'line',
      pointsData: [{ x: 0, y: 0 }],
      strokeColor: '#000000',
      strokeWidth: 1,
    });
    await realDb().insert(measurementTemplates).values({
      sceneId: scene.id,
      createdBy: oldId,
      templateType: 'cone',
      originX: 0,
      originY: 0,
      direction: 0,
      distance: 15,
      color: '#ffffff',
      opacity: 1,
      isTemporary: false,
    });

    const res = await signIn({
      id: newId,
      email,
      emailVerified: true,
      firstName: 'Re',
      lastName: 'Linked',
    });
    expectSuccessfulSignIn(res);

    // The old row is gone; the new id carries the OLD row (plan survives the move).
    expect(await userRow(oldId)).toBeNull();
    const moved = await userRow(newId);
    expect(moved).not.toBeNull();
    expect(moved?.plan).toBe('pro');

    // Everything the old id owned is owned by the new id now.
    expect(await campaignsOf(oldId)).toHaveLength(0);
    expect(await campaignsOf(newId)).toHaveLength(2);
    const movedCharacter = await realDb()
      .select()
      .from(characters)
      .where(eq(characters.id, character.id));
    expect(movedCharacter[0]?.userId).toBe(newId);
    expect(movedCharacter[0]?.ownerId).toBe(newId);
    const usage = await realDb().select().from(aiUsage).where(eq(aiUsage.userId, newId));
    expect(usage).toHaveLength(1);

    // The rest of the census, one assertion per moved (table, column):
    // the seeded row now names the new id.
    const chronicles = await realDb()
      .select()
      .from(sessionChronicles)
      .where(eq(sessionChronicles.userId, newId));
    expect(chronicles).toHaveLength(1);
    const perms = await realDb()
      .select()
      .from(characterPermissions)
      .where(eq(characterPermissions.characterId, character.id));
    expect(perms).toHaveLength(2);
    const ownGrant = perms.find((p) => p.userId === newId);
    expect(ownGrant?.grantedBy).toBe(otherId);
    const grantedByOld = perms.find((p) => p.grantedBy === newId);
    expect(grantedByOld?.userId).toBe(otherId);
    const folders = await realDb()
      .select()
      .from(characterFolders)
      .where(eq(characterFolders.userId, newId));
    expect(folders).toHaveLength(1);
    const fb = await realDb().select().from(feedback).where(eq(feedback.userId, newId));
    expect(fb).toHaveLength(1);
    const jobs = await realDb()
      .select()
      .from(memoryExtractionJobs)
      .where(eq(memoryExtractionJobs.userId, newId));
    expect(jobs).toHaveLength(1);
    const movedScenes = await realDb().select().from(scenes).where(eq(scenes.userId, newId));
    expect(movedScenes).toHaveLength(1);
    const fog = await realDb().select().from(fogOfWar).where(eq(fogOfWar.userId, newId));
    expect(fog).toHaveLength(1);
    const shapes = await realDb()
      .select()
      .from(visionBlockingShapes)
      .where(eq(visionBlockingShapes.createdBy, newId));
    expect(shapes).toHaveLength(1);
    const drawings = await realDb()
      .select()
      .from(sceneDrawings)
      .where(eq(sceneDrawings.createdBy, newId));
    expect(drawings).toHaveLength(1);
    const templates = await realDb()
      .select()
      .from(measurementTemplates)
      .where(eq(measurementTemplates.createdBy, newId));
    expect(templates).toHaveLength(1);
  });

  test('an email differing only by case still matches (and moves)', async () => {
    const oldId = testId('user-case-old');
    const newId = testId('user-case-new');
    seededUserIds.push(newId);
    const storedEmail = `${testId('MiXeD')}@Example.test`;
    await seedUser(oldId, storedEmail, 'pro');
    await seedCampaign(oldId);

    const res = await signIn({
      id: newId,
      email: storedEmail.toLowerCase(),
      emailVerified: true,
      firstName: 'C',
      lastName: 'S',
    });
    expectSuccessfulSignIn(res);

    expect(await userRow(oldId)).toBeNull();
    expect((await userRow(newId))?.plan).toBe('pro');
    expect(await campaignsOf(newId)).toHaveLength(1);
  });

  test('two rows with the verified email: nothing is re-linked', async () => {
    const oldA = testId('user-dup-a');
    const oldB = testId('user-dup-b');
    const newId = testId('user-dup-new');
    seededUserIds.push(newId);
    const email = `${testId('dup')}@example.test`;
    await seedUser(oldA, email);
    await seedUser(oldB, email);
    await seedCampaign(oldA);

    const res = await signIn({ id: newId, email, emailVerified: true, firstName: 'D', lastName: 'P' });
    expectSuccessfulSignIn(res);

    expect(await userRow(oldA)).not.toBeNull();
    expect(await userRow(oldB)).not.toBeNull();
    // The sign-in itself proceeded: a fresh row exists under the new id.
    expect(await userRow(newId)).not.toBeNull();
    expect(await campaignsOf(oldA)).toHaveLength(1);
    expect(await campaignsOf(newId)).toHaveLength(0);
  });

  test('an unverified email never re-links, even with exactly one match', async () => {
    const oldId = testId('user-unverified');
    const newId = testId('user-unverified-new');
    seededUserIds.push(newId);
    const email = `${testId('unv')}@example.test`;
    await seedUser(oldId, email);
    await seedCampaign(oldId);

    const res = await signIn({
      id: newId,
      email,
      emailVerified: false,
      firstName: 'U',
      lastName: 'V',
    });
    expectSuccessfulSignIn(res);

    expect(await userRow(oldId)).not.toBeNull();
    expect(await campaignsOf(oldId)).toHaveLength(1);
    expect(await campaignsOf(newId)).toHaveLength(0);
    // #1040: and no users row is created either — a row materialised for an
    // email this sign-in never verified would sit beside the real owner's
    // row and block their re-link as ambiguous (next case). The row is
    // created by the first verified sign-in instead.
    expect(await userRow(newId)).toBeNull();
  });

  test('#1040: an unverified sign-up with the owner email creates no row, and the owner still re-links', async () => {
    const victimOldId = testId('user-victim-old');
    const attackerId = testId('user-attacker');
    const victimNewId = testId('user-victim-new');
    seededUserIds.push(attackerId, victimNewId);
    const email = `${testId('victim')}@example.test`;
    await seedUser(victimOldId, email, 'pro');
    await seedCampaign(victimOldId);

    // The attack: a sign-up claims the victim's email but never verifies it
    // (the verification goes to the victim's inbox). The sign-in itself
    // succeeds — but it must not materialise a users row.
    const attack = await signIn({
      id: attackerId,
      email,
      emailVerified: false,
      firstName: 'A',
      lastName: 'T',
    });
    expectSuccessfulSignIn(attack);
    expect(await userRow(attackerId)).toBeNull();
    expect(await userRow(victimOldId)).not.toBeNull();
    expect(await campaignsOf(victimOldId)).toHaveLength(1);

    // The real owner arrives from the new WorkOS environment, verified:
    // exactly one row carries the email, so the re-link completes. On main
    // the attacker's row made this two matches and nothing ever moved.
    const res = await signIn({
      id: victimNewId,
      email,
      emailVerified: true,
      firstName: 'V',
      lastName: 'O',
    });
    expectSuccessfulSignIn(res);
    expect(await userRow(victimOldId)).toBeNull();
    expect((await userRow(victimNewId))?.plan).toBe('pro');
    expect(await campaignsOf(victimNewId)).toHaveLength(1);
    expect(await campaignsOf(attackerId)).toHaveLength(0);
  });

  test('#1040: a first verified sign-in creates the row an earlier unverified sign-in did not', async () => {
    const freshId = testId('user-fresh');
    seededUserIds.push(freshId);
    const email = `${testId('fresh')}@example.test`;

    const unverified = await signIn({
      id: freshId,
      email,
      emailVerified: false,
      firstName: 'F',
      lastName: 'R',
    });
    expectSuccessfulSignIn(unverified);
    expect(await userRow(freshId)).toBeNull();

    // Same WorkOS id, now verified: the row the unverified sign-in was
    // denied is created, under the same id anything created in the
    // meantime would already carry.
    const verified = await signIn({
      id: freshId,
      email,
      emailVerified: true,
      firstName: 'F',
      lastName: 'R',
    });
    expectSuccessfulSignIn(verified);
    const row = await userRow(freshId);
    expect(row).not.toBeNull();
    expect(row?.email).toBe(email);
  });

  test('the old id still resolving in WorkOS: nothing is re-linked (takeover guard)', async () => {
    const oldId = testId('user-live-old');
    const newId = testId('user-live-new');
    seededUserIds.push(newId);
    const email = `${testId('live')}@example.test`;
    await seedUser(oldId, email, 'pro');
    await seedCampaign(oldId);

    // The old account is still a live user in this WorkOS environment and
    // its row's email is simply stale — the new id must NOT inherit it.
    const res = await signIn(
      { id: newId, email, emailVerified: true, firstName: 'N', lastName: 'O' },
      'live',
    );
    expectSuccessfulSignIn(res);

    expect(await userRow(oldId)).not.toBeNull();
    expect((await userRow(oldId))?.plan).toBe('pro');
    expect(await campaignsOf(oldId)).toHaveLength(1);
    expect(await campaignsOf(newId)).toHaveLength(0);
    expect(await userRow(newId)).not.toBeNull();
  });

  test('the old id liveness check failing: nothing moves, no row is created, and a later sign-in retries', async () => {
    const oldId = testId('user-unknown-old');
    const newId = testId('user-unknown-new');
    seededUserIds.push(newId);
    const email = `${testId('unk')}@example.test`;
    await seedUser(oldId, email);
    await seedCampaign(oldId);

    const res = await signIn(
      { id: newId, email, emailVerified: true, firstName: 'U', lastName: 'K' },
      'error',
    );
    expectSuccessfulSignIn(res);

    // Nothing moved — and, unlike a quiet skip, NO fresh row was created
    // under the new id: one would seal the account behind the by-id gate
    // and the promised retry would never happen.
    expect(await userRow(oldId)).not.toBeNull();
    expect(await campaignsOf(oldId)).toHaveLength(1);
    expect(await campaignsOf(newId)).toHaveLength(0);
    expect(await userRow(newId)).toBeNull();

    // WorkOS healthy again (old id now positively not found): the retry on
    // the next callback completes the re-link.
    const retry = await signIn({ id: newId, email, emailVerified: true, firstName: 'U', lastName: 'K' });
    expectSuccessfulSignIn(retry);
    expect(await userRow(oldId)).toBeNull();
    expect(await userRow(newId)).not.toBeNull();
    expect(await campaignsOf(newId)).toHaveLength(1);
  });

  test('#1040: a bare 404 that is not the WorkOS NotFoundException is liveness unknown, not proof the old id is gone', async () => {
    const oldId = testId('user-bare404-old');
    const newId = testId('user-bare404-new');
    seededUserIds.push(newId);
    const email = `${testId('b404')}@example.test`;
    await seedUser(oldId, email, 'pro');
    await seedCampaign(oldId);

    // The stub's getUser fails with a status-404 error that is NOT the
    // SDK's NotFoundException (an intermediary's error shape). Only the
    // SDK exception proves the old account is gone; this proves nothing,
    // so the behaviour is the liveness-unknown one: nothing moves, no row
    // is created, and the next sign-in retries. On main the status check
    // accepted any 404 and the account moved on this unproven answer.
    const res = await signIn(
      { id: newId, email, emailVerified: true, firstName: 'B', lastName: '4' },
      'bare-404',
    );
    expectSuccessfulSignIn(res);
    expect(await userRow(oldId)).not.toBeNull();
    expect(await campaignsOf(oldId)).toHaveLength(1);
    expect(await campaignsOf(newId)).toHaveLength(0);
    expect(await userRow(newId)).toBeNull();

    // The retry, with the SDK's real not-found answer, completes the re-link.
    const retry = await signIn({ id: newId, email, emailVerified: true, firstName: 'B', lastName: '4' });
    expectSuccessfulSignIn(retry);
    expect(await userRow(oldId)).toBeNull();
    expect((await userRow(newId))?.plan).toBe('pro');
    expect(await campaignsOf(newId)).toHaveLength(1);
  });

  test('a re-link that throws mid-move (owned-row collision) creates no row and retries after the conflict clears', async () => {
    const oldId = testId('user-collide-old');
    const newId = testId('user-collide-new');
    seededUserIds.push(newId);
    const email = `${testId('col')}@example.test`;
    await seedUser(oldId, email);
    await seedCampaign(oldId);
    const [character] = await realDb()
      .insert(characters)
      .values({ userId: oldId, name: 'Collision Hero' })
      .returning({ id: characters.id });
    await realDb().insert(characterPermissions).values({
      characterId: character.id,
      userId: oldId,
      grantedBy: oldId,
    });
    // The residual-(ii) shape: an owned row already exists under the new
    // id (e.g. created via password-login tokens before any OAuth
    // callback), so the permissions move violates the (character, user)
    // unique constraint mid-transaction.
    const [blocker] = await realDb()
      .insert(characterPermissions)
      .values({ characterId: character.id, userId: newId, grantedBy: oldId })
      .returning({ id: characterPermissions.id });

    const res = await signIn({ id: newId, email, emailVerified: true, firstName: 'C', lastName: 'X' });
    expectSuccessfulSignIn(res);

    // The whole move rolled back, the account is untouched, and no fresh
    // row seals it: the failure is loud, not final.
    expect(await userRow(oldId)).not.toBeNull();
    expect(await campaignsOf(oldId)).toHaveLength(1);
    expect(await userRow(newId)).toBeNull();

    // Ops clears the conflict; the next callback's retry links the account.
    await realDb().delete(characterPermissions).where(eq(characterPermissions.id, blocker.id));
    const retry = await signIn({ id: newId, email, emailVerified: true, firstName: 'C', lastName: 'X' });
    expectSuccessfulSignIn(retry);
    expect(await userRow(oldId)).toBeNull();
    expect(await campaignsOf(newId)).toHaveLength(1);
    const perms = await realDb()
      .select()
      .from(characterPermissions)
      .where(eq(characterPermissions.characterId, character.id));
    expect(perms[0]?.userId).toBe(newId);
  });

  test('a sign-in whose id already has a row never touches another account with the same email', async () => {
    const knownId = testId('user-known');
    const otherId = testId('user-other');
    const email = `${testId('shared')}@example.test`;
    await seedUser(knownId, `${testId('known')}@example.test`);
    await seedUser(otherId, email);
    await seedCampaign(otherId);

    const res = await signIn({
      id: knownId,
      email,
      emailVerified: true,
      firstName: 'K',
      lastName: 'N',
    });
    expectSuccessfulSignIn(res);

    expect(await userRow(otherId)).not.toBeNull();
    expect(await campaignsOf(otherId)).toHaveLength(1);
    expect(await campaignsOf(knownId)).toHaveLength(0);
  });
});

if (!hasRealDb) {
  describe('#206 WorkOS re-link (skipped without a database)', () => {
    test('skips', () => {
      expect(hasRealDb).toBe(false);
    });
  });
}
