/**
 * #206 (M4): WorkOS environment switch — account re-link in the auth callback.
 *
 * `users.id` is the WorkOS user id. When prod moves from the staging WorkOS
 * environment to the production one, every returning user arrives with a NEW
 * WorkOS id while their rows still carry the old one. The callback must
 * re-link: if no `users` row has the new id but exactly one row has the
 * verified email WorkOS returned, that row and every row it owns move to the
 * new id in one transaction. More than one match, or an unverified email,
 * moves nothing.
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

import { aiUsage, campaigns, characters, users } from '../../../../../db/schema/index';
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

async function signIn(user: Record<string, unknown>): Promise<Response> {
  if (!app) throw new Error('signIn called without a database-backed app');
  stubbedUser = user;
  const state = `state-${testId('s')}`;
  return app.handle(
    new Request(`http://localhost/v1/auth/callback?code=stub-code&state=${state}`, {
      headers: { cookie: `ir_oauth_state=${state}` },
    }),
  );
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
      await realDb().delete(aiUsage).where(inArray(aiUsage.userId, seededUserIds));
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
      .values({ userId: oldId, name: 'Relink Hero' })
      .returning({ id: characters.id });
    await realDb()
      .insert(aiUsage)
      .values({ userId: oldId, type: 'llm', units: 3, periodStart: new Date() });

    const res = await signIn({
      id: newId,
      email,
      emailVerified: true,
      firstName: 'Re',
      lastName: 'Linked',
    });
    expect(res.status).toBe(302);

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
    const usage = await realDb().select().from(aiUsage).where(eq(aiUsage.userId, newId));
    expect(usage).toHaveLength(1);
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
    expect(res.status).toBe(302);

    expect(await userRow(oldA)).not.toBeNull();
    expect(await userRow(oldB)).not.toBeNull();
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
    expect(res.status).toBe(302);

    expect(await userRow(oldId)).not.toBeNull();
    expect(await campaignsOf(oldId)).toHaveLength(1);
    expect(await campaignsOf(newId)).toHaveLength(0);
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
    expect(res.status).toBe(302);

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
