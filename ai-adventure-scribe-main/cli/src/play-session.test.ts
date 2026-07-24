import { describe, expect, it } from 'vitest';

import { selectPlaySession, templateListRows, type PlaySessionApi, type StarterTemplate } from './play-session';

const starter = {
  id: 'the-eternal-feast',
  title: 'The Eternal Feast',
  premise: 'A cursed banquet needs a brave guest.',
  genre: ['fantasy'],
  tone: ['gothic'],
  difficulty: 'normal',
  coverImageUrl: '/feast.png',
};

const template: StarterTemplate = {
  template_key: 'the-seeker',
  name: 'Ari Seeker',
  class: 'Wizard',
  race: 'Human',
  level: 1,
  ability_scores: { strength: 8, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 },
  equipment: ['Dagger', 'Spellbook'],
};

function makeApi(sessions: Array<{ id: string; session_number?: number; starter_campaign_id?: string }> = []) {
  const calls: Record<string, Record<string, unknown>[]> = { campaigns: [], characters: [], sessions: [] };
  const api: PlaySessionApi = {
    listSessions: async () => sessions,
    getSessionContext: async () => ({ campaign_id: 'campaign-existing', character_id: 'character-existing', starter_campaign_id: 'the-eternal-feast' }),
    listStarterCharacterTemplates: async () => [template],
    listCharacters: async () => [{ id: 'character-existing' }],
    listCampaigns: async () => [],
    createCampaign: async (payload) => { calls.campaigns.push(payload); return { id: 'campaign-new' }; },
    createCharacter: async (payload) => { calls.characters.push(payload); return { id: 'character-new' }; },
    createSession: async (payload) => { calls.sessions.push(payload); return { id: 'session-new' }; },
  };
  return { api, calls };
}

describe('headless play session bootstrap', () => {
  it('bootstraps a no-session account with the browser campaign payload and fully seeded character', async () => {
    const { api, calls } = makeApi();
    const sessionId = await selectPlaySession(
      { campaign: 'the-eternal-feast', fresh: true, auto: true }, api,
      { getStarterCampaign: async () => starter, chooseTemplate: async () => template, log: () => undefined },
    );

    expect(sessionId).toBe('session-new');
    expect(calls.campaigns[0]).toMatchObject({ name: 'The Eternal Feast', genre: 'fantasy', tone: 'gothic' });
    expect(calls.characters[0]).toMatchObject({ campaign_id: 'campaign-new', image_url: null, avatar_url: null });
    expect(calls.characters[0].equipment).toEqual(expect.arrayContaining([expect.objectContaining({ item_name: 'Dagger' })]));
    expect(calls.characters[0].known_spells).not.toBe('');
    expect(calls.sessions[0]).toMatchObject({ campaign_id: 'campaign-new', character_id: 'character-new', starter_campaign_id: 'the-eternal-feast', status: 'active' });
  });

  it('resumes without --new and creates a new session with the existing character when requested', async () => {
    const { api, calls } = makeApi([{ id: 'session-old', session_number: 4, starter_campaign_id: 'the-eternal-feast' }]);
    const dependencies = { getStarterCampaign: async () => starter, chooseTemplate: async () => template, log: () => undefined };
    await expect(selectPlaySession({ campaign: 'the-eternal-feast', fresh: false, auto: false }, api, dependencies)).resolves.toBe('session-old');
    await expect(selectPlaySession({ campaign: 'the-eternal-feast', fresh: true, auto: false }, api, dependencies)).resolves.toBe('session-new');
    expect(calls.characters).toHaveLength(0);
    expect(calls.sessions[0]).toMatchObject({ session_number: 5, character_id: 'character-existing' });
  });

  it('lists template keys, names, and classes for agents', () => {
    expect(templateListRows([template])).toEqual([{ key: 'the-seeker', name: 'Ari Seeker', class: 'Wizard' }]);
  });
});
