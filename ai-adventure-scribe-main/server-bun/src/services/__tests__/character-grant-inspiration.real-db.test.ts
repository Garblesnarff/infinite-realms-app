/**
 * #1537: CharacterService.grantInspiration writes the flag once. Real database, service level:
 * the grant is a compare-and-set on the personality envelope, so a second grant is refused with
 * no write, every other envelope key survives the write, and a stranger cannot grant.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  grantLegendPlan,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import { campaigns, characters } from '../../../../db/schema/index';

import type { CharacterService as CharacterServiceType } from '../character-service.js';

describeWithDb('CharacterService.grantInspiration (#1537)', () => {
  let db: ReturnType<typeof realDb>;
  let CharacterService: typeof CharacterServiceType;
  const userId = testId('user-1537');
  const strangerId = testId('user-1537-stranger');
  let campaignId = '';
  let characterId = '';

  beforeAll(async () => {
    db = realDb();
    await grantLegendPlan(userId);
    CharacterService = await importWithRealDb(async () => {
      const module = await import('../character-service.js');
      return module.CharacterService;
    });
    const [campaign] = await db
      .insert(campaigns)
      .values({ userId, name: testId('1537-campaign') })
      .returning({ id: campaigns.id });
    campaignId = campaign.id;
    const [hero] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('1537-hero'),
        race: 'Human',
        class: 'Fighter',
        level: 1,
        personalityNotes: JSON.stringify({ traits: ['Brave'], inspiration: false }),
      })
      .returning({ id: characters.id });
    characterId = hero.id;
  });

  afterAll(async () => {
    if (characterId) await db.delete(characters).where(eq(characters.id, characterId));
    if (campaignId) await db.delete(campaigns).where(inArray(campaigns.id, [campaignId]));
    await closeRealDb();
  });

  test('a grant writes true once and keeps the other envelope keys', async () => {
    const first = await CharacterService.grantInspiration(characterId, userId);
    expect(first).toEqual({ success: true, inspiration: true });

    const [row] = await db
      .select({ personalityNotes: characters.personalityNotes })
      .from(characters)
      .where(eq(characters.id, characterId));
    const saved = JSON.parse(row.personalityNotes as string) as Record<string, unknown>;
    expect(saved.inspiration).toBe(true);
    expect(saved.traits).toEqual(['Brave']);
  });

  test('a second grant while the hero holds Inspiration is refused and writes nothing', async () => {
    const [before] = await db
      .select({ personalityNotes: characters.personalityNotes })
      .from(characters)
      .where(eq(characters.id, characterId));

    const second = await CharacterService.grantInspiration(characterId, userId);
    expect(second).toEqual({ success: false, reason: 'already_held' });

    const [after] = await db
      .select({ personalityNotes: characters.personalityNotes })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(after.personalityNotes).toBe(before.personalityNotes);
  });

  test('a user with no access to the character cannot grant it', async () => {
    const result = await CharacterService.grantInspiration(characterId, strangerId);
    expect(result.success).toBe(false);
  });
});
