// Offline fixture API for e2e/public-pages-1664.spec.ts (and public-pages-layout.spec.ts). Serves PostgREST-shaped rows on 127.0.0.1:4566.
// Run: node e2e/fixtures/public-pages-api.mjs   (then build the client with VITE_SUPABASE_URL and VITE_API_URL set to http://127.0.0.1:4566)
import http from 'node:http';

const campaigns = [
  {
    id: 'c-abyssal',
    slug: 'abyssal-descent',
    title: 'Abyssal Descent',
    tagline: 'Abyssal Descent',
    genre: ['Horror', 'Dungeon', 'Mystery'],
    tone: ['dark', 'tense'],
    difficulty: 'medium',
    level_range: '7-10-11',
    estimated_sessions: '10-15',
    premise:
      'The rope is slick with cold water. Something below the ledge has been waiting for a long time.',
    creative_brief: null,
    overview: null,
    is_complete: true,
    is_published: true,
    is_featured: true,
    cover_image_url: null,
    banner_image_url: null,
  },
  {
    id: 'c-midsummer',
    slug: 'a-midsummer-nights-chaos',
    title: "A Midsummer Night's Chaos",
    tagline: 'Fey courts and bad bargains.',
    genre: ['Fantasy'],
    tone: ['whimsical'],
    difficulty: 'easy',
    level_range: '1-3',
    estimated_sessions: '6-8',
    premise: 'A fey festival has gone wrong and the lanterns will not go out.',
    creative_brief: null,
    overview: null,
    is_complete: true,
    is_published: true,
    is_featured: false,
    cover_image_url: null,
    banner_image_url: null,
  },
  {
    id: 'c-academy',
    slug: 'academy-of-arcane-gastronomy',
    title: 'Academy of Arcane Gastronomy',
    tagline: 'Cook or be cooked.',
    genre: ['Comedy', 'Fantasy'],
    tone: ['light'],
    difficulty: 'hard',
    level_range: '2-4',
    estimated_sessions: '1',
    premise:
      'The kitchens of the Academy are haunted by a sauce that remembers every chef who failed it.',
    creative_brief: null,
    overview: null,
    is_complete: true,
    is_published: true,
    is_featured: false,
    cover_image_url: null,
    banner_image_url: null,
  },
];

const hero = (i, name, race, cls, hp) => ({
  id: `t-${i}`,
  starter_campaign_id: 'c-abyssal',
  template_key: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  tagline: 'A hard-bitten survivor of the deep',
  race,
  subrace: null,
  class: cls,
  subclass: null,
  background: 'Soldier',
  level: 7,
  ability_scores: {
    strength: 14,
    dexterity: 12,
    constitution: 15,
    intelligence: 10,
    wisdom: 11,
    charisma: 9,
  },
  personality: { traits: [], ideals: [], bonds: [], flaws: [] },
  skills: [],
  languages: ['Common'],
  equipment: [],
  adapted_backstory: null,
  campaign_hook: null,
  portrait_url: null,
  card_image_url: null,
  portrait_prompt: null,
  display_order: i,
  spells: null,
});
const templates = [
  hero(0, 'Bram', 'Dwarf', 'Fighter'),
  hero(1, 'Lysa Vaughn', 'Human', 'Rogue'),
  hero(2, 'Odran Pell', 'Half-Elf', 'Cleric'),
  hero(3, 'Mirela Thorn', 'Elf', 'Ranger'),
  hero(4, 'Kestrel Ashe', 'Tiefling', 'Wizard'),
];

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS,HEAD',
};
const send = (res, status, body) => {
  res.writeHead(status, { ...cors, 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://127.0.0.1:4566');
    const p = url.pathname;
    if (p === '/rest/v1/starter_campaigns') {
      const slugEq = url.searchParams.get('slug')?.replace(/^eq\./, '');
      let rows = campaigns;
      if (slugEq) rows = campaigns.filter((c) => c.slug === slugEq);
      if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) {
        if (rows.length !== 1)
          return send(res, 406, {
            code: 'PGRST116',
            message: 'no rows',
            details: null,
            hint: null,
          });
        return send(res, 200, rows[0]);
      }
      return send(res, 200, rows);
    }
    if (p === '/v1/starter-character-templates') {
      if (url.searchParams.get('id'))
        return send(res, 200, templates.find((t) => t.id === url.searchParams.get('id')) ?? null);
      return send(res, 200, templates);
    }
    if (p.startsWith('/rest/v1/')) return send(res, 200, []);
    return send(res, 404, { message: 'not in fixture' });
  })
  .listen(4566, '127.0.0.1', () => console.log('fixture on 4566'));
