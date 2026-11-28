/**
 * #1755: a fight at a story map place uses that place's board. The gate merges the place's
 * environment, size and seed into the scene and runs the real sanitizer; with no current place
 * the scene is what it was before this change.
 */
import { afterAll, describe, expect, it, spyOn } from 'bun:test';

import { logger } from '../../lib/logger.js';
import { generateMap } from '../../tactical/generator.js';
import { emptyCampaignMonsterIndex } from '../combat/campaign-monster-index.js';
import { applyCombatEntryGate } from '../combat-entry-pipeline.js';

import type { SceneSpec } from '../../tactical/types.js';
import type { PlaceFightRecipe } from '../story-map/story-map-service.js';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const USER_ID = 'user-1755';
const COMBAT_ENTRY = {
  sessionId: SESSION_ID,
  player: { characterId: 'character-1', name: 'The Storyteller', initiativeModifier: 2 },
};
const CRYPT: PlaceFightRecipe = {
  placeKey: 'the-crypt',
  environment: 'cave',
  size: 'small',
  seed: 424242,
};

const info = spyOn(logger, 'info').mockImplementation((() => {}) as typeof logger.info);
const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
afterAll(() => {
  info.mockRestore();
  warn.mockRestore();
});

/** A DM turn that starts a fight with the Ifrit Guard, with the DM's own scene_spec. */
const startTurn = (sceneSpec: Record<string, unknown> | null): string =>
  JSON.stringify({
    text: 'The Ifrit Guard lunges out of the dark.',
    combat_transition: 'start',
    scene_spec: sceneSpec,
    combatants: [{ name: 'Ifrit Guard', count: 1 }],
    map_actions: [],
    combat_actions: [],
    roll_requests: [],
  });

async function pendingScene(
  sceneSpec: Record<string, unknown> | null,
  placeFightRecipe: (sessionId: string, userId: string) => Promise<PlaceFightRecipe | null>,
): Promise<SceneSpec> {
  const returned = await applyCombatEntryGate({
    result: { text: startTurn(sceneSpec) } as never,
    userId: USER_ID,
    combatEntry: COMBAT_ENTRY,
    liveEncounter: async () => null,
    campaignMonsterIndex: async () => emptyCampaignMonsterIndex('campaign-1755'),
    encounterContext: async () => ({}) as never,
    placeFightRecipe,
  });
  const envelope = JSON.parse(returned.text) as {
    combat_entry_pending?: { sceneSpec: SceneSpec };
  };
  expect(envelope.combat_entry_pending).toBeDefined();
  return envelope.combat_entry_pending!.sceneSpec;
}

describe('#1755 combat entry at a story map place', () => {
  it("fills environment, size and seed from the current place and keeps the DM's description", async () => {
    const calls: Array<[string, string]> = [];
    const scene = await pendingScene(
      { environment: 'tavern', size: 'large', seed: 7, sceneDescription: 'Dripping tombs.' },
      async (sessionId, userId) => {
        calls.push([sessionId, userId]);
        return CRYPT;
      },
    );
    expect(calls).toEqual([[SESSION_ID, USER_ID]]);
    expect(scene).toMatchObject({
      environment: 'cave',
      size: 'small',
      seed: 424242,
      sceneDescription: 'Dripping tombs.',
      sessionId: SESSION_ID,
    });
  });

  it('two fights at the same place give the same board, whatever scene the DM wrote', async () => {
    const first = await pendingScene(
      { environment: 'tavern', size: 'large', seed: 1 },
      async () => CRYPT,
    );
    const second = await pendingScene(
      { environment: 'open_field', size: 'medium', seed: 99 },
      async () => CRYPT,
    );
    const a = generateMap({ ...first, id: 'board' });
    const b = generateMap({ ...second, id: 'board' });
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(a.cells).toEqual(b.cells);
  });

  it('a start with no scene_spec (synthesized scene) also gets the place board', async () => {
    const scene = await pendingScene(null, async () => CRYPT);
    expect(scene).toMatchObject({ environment: 'cave', size: 'small', seed: 424242 });
  });

  it('with no current place the scene is unchanged', async () => {
    const dmScene = { environment: 'tavern', size: 'large', seed: 7 };
    const scene = await pendingScene(dmScene, async () => null);
    expect(scene).toMatchObject(dmScene);
  });

  it('a failed read or a recipe the sanitizer rejects leaves the scene unchanged', async () => {
    const dmScene = { environment: 'tavern', size: 'large', seed: 7 };
    const failed = await pendingScene(dmScene, async () => {
      throw new Error('database down');
    });
    expect(failed).toMatchObject(dmScene);
    const illegal = await pendingScene(dmScene, async () => ({
      ...CRYPT,
      environment: 'moon_base',
    }));
    expect(illegal).toMatchObject(dmScene);
  });
});
