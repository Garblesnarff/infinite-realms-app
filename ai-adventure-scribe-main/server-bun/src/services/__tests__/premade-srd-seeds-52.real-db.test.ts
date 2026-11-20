/**
 * #52 SRD seed fix migration, against a real database.
 *
 * The migration file ships unapplied, so this proves the data mapping,
 * re-runnability, the guards, and the loud failure.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { Client } from 'pg';

import { closeRealDb, describeWithDb, hasRealDb, realDbUrl } from './fixtures/real-db.js';

const MIGRATION_SQL = hasRealDb
  ? readFileSync(
      new URL(
        '../../../../supabase/migrations/20261117_fix_premade_srd_subrace_and_origin_2014.sql',
        import.meta.url,
      ),
      'utf8',
    )
  : '';

const ACADEMY_CAMPAIGN_ID = 'academy-of-arcane-gastronomy';
const MIDSUMMER_CAMPAIGN_ID = 'a-midsummer-nights-chaos';

let createdAcademy = false;
let createdMidsummer = false;

interface TemplateRow {
  subrace: string | null;
  subclass: string | null;
  ability_scores: Record<string, number>;
  [column: string]: unknown;
}

const FOUR_TEMPLATES: Array<{ campaign: string; key: string }> = [
  { campaign: ACADEMY_CAMPAIGN_ID, key: 'the-gourmand' },
  { campaign: ACADEMY_CAMPAIGN_ID, key: 'the-sous-chef' },
  { campaign: ACADEMY_CAMPAIGN_ID, key: 'the-herbalist' },
  { campaign: MIDSUMMER_CAMPAIGN_ID, key: 'the-lovesick' },
];

const preExistingExisted: boolean[] = [];
const preExistingSnapshots: (TemplateRow | null)[] = [];

async function ensureCampaigns(): Promise<void> {
  const client = new Client({ connectionString: realDbUrl });
  await client.connect();
  try {
    for (const [id, title] of [
      [ACADEMY_CAMPAIGN_ID, 'Academy of Arcane Gastronomy'],
      [MIDSUMMER_CAMPAIGN_ID, "A Midsummer Night's Chaos"],
    ] as const) {
      const existing = await client.query('SELECT id FROM public.starter_campaigns WHERE id = $1', [
        id,
      ]);
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO public.starter_campaigns
             (id, slug, title, genre, tone, difficulty, premise, is_complete, is_published)
           VALUES ($1, $1, $2,
                   ARRAY['fantasy']::text[], ARRAY['test']::text[],
                   'medium', 'Test campaign row for the #52 SRD seed proof.',
                   false, false)`,
          [id, title],
        );
        if (id === ACADEMY_CAMPAIGN_ID) createdAcademy = true;
        else createdMidsummer = true;
      }
    }
  } finally {
    await client.end();
  }
}

async function upsertBaseRows(): Promise<void> {
  const client = new Client({ connectionString: realDbUrl });
  await client.connect();
  try {
    const rows = [
      {
        campaign: ACADEMY_CAMPAIGN_ID,
        key: 'the-gourmand',
        name: 'The Gourmand',
        race: 'Dwarf',
        subrace: null,
        cls: 'Fighter',
        subclass: null,
        scores: { STR: 16, DEX: 12, CON: 16, INT: 8, WIS: 10, CHA: 10 },
      },
      {
        campaign: ACADEMY_CAMPAIGN_ID,
        key: 'the-sous-chef',
        name: 'The Sous Chef',
        race: 'Tiefling',
        subrace: null,
        cls: 'Sorcerer',
        subclass: null,
        scores: { STR: 8, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 16 },
      },
      {
        campaign: MIDSUMMER_CAMPAIGN_ID,
        key: 'the-lovesick',
        name: 'The Lovesick',
        race: 'Half-Elf',
        subrace: null,
        cls: 'Sorcerer',
        subclass: null,
        scores: {
          strength: 8,
          dexterity: 14,
          constitution: 14,
          intelligence: 12,
          wisdom: 10,
          charisma: 16,
        },
      },
      {
        campaign: ACADEMY_CAMPAIGN_ID,
        key: 'the-herbalist',
        name: 'The Herbalist',
        race: 'Half-Elf',
        subrace: null,
        cls: 'Druid',
        subclass: null,
        scores: { STR: 10, DEX: 12, CON: 12, INT: 12, WIS: 16, CHA: 12 },
      },
    ];
    for (const r of rows) {
      await client.query(
        `INSERT INTO public.starter_character_templates
           (starter_campaign_id, template_key, name, race, subrace, class, subclass, ability_scores)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (starter_campaign_id, template_key) DO UPDATE SET
           name = EXCLUDED.name,
           race = EXCLUDED.race,
           subrace = EXCLUDED.subrace,
           class = EXCLUDED.class,
           subclass = EXCLUDED.subclass,
           ability_scores = EXCLUDED.ability_scores,
           updated_at = now()`,
        [r.campaign, r.key, r.name, r.race, r.subrace, r.cls, r.subclass, JSON.stringify(r.scores)],
      );
    }
  } finally {
    await client.end();
  }
}

async function runMigration(): Promise<void> {
  const client = new Client({ connectionString: realDbUrl });
  await client.connect();
  try {
    await client.query(MIGRATION_SQL);
  } finally {
    await client.end();
  }
}

async function templateExists(campaign: string, key: string): Promise<boolean> {
  const client = new Client({ connectionString: realDbUrl });
  await client.connect();
  try {
    const res = await client.query(
      'SELECT 1 FROM public.starter_character_templates WHERE starter_campaign_id = $1 AND template_key = $2',
      [campaign, key],
    );
    return res.rows.length > 0;
  } finally {
    await client.end();
  }
}

async function fetchRow(campaign: string, key: string): Promise<TemplateRow> {
  const client = new Client({ connectionString: realDbUrl });
  await client.connect();
  try {
    const res = await client.query(
      'SELECT * FROM public.starter_character_templates WHERE starter_campaign_id = $1 AND template_key = $2',
      [campaign, key],
    );
    return res.rows[0] as TemplateRow;
  } finally {
    await client.end();
  }
}

async function updateRow(
  campaign: string,
  key: string,
  setSql: string,
  params: unknown[],
): Promise<void> {
  const client = new Client({ connectionString: realDbUrl });
  await client.connect();
  try {
    await client.query(
      `UPDATE public.starter_character_templates SET ${setSql} WHERE starter_campaign_id = $1 AND template_key = $2`,
      [campaign, key, ...params],
    );
  } finally {
    await client.end();
  }
}

function stripUpdatedAt(row: TemplateRow): TemplateRow {
  const { updated_at: _updated_at, ...rest } = row;
  return rest as TemplateRow;
}

describeWithDb('premade SRD seeds #52', () => {
  beforeAll(async () => {
    for (const t of FOUR_TEMPLATES) {
      const existed = await templateExists(t.campaign, t.key);
      preExistingExisted.push(existed);
      preExistingSnapshots.push(existed ? await fetchRow(t.campaign, t.key) : null);
    }
    await ensureCampaigns();
    await upsertBaseRows();
  });

  beforeEach(async () => {
    await upsertBaseRows();
  });

  afterAll(async () => {
    const client = new Client({ connectionString: realDbUrl });
    await client.connect();
    try {
      for (let i = 0; i < FOUR_TEMPLATES.length; i++) {
        const t = FOUR_TEMPLATES[i];
        const snap = preExistingSnapshots[i];
        const existed = preExistingExisted[i];
        if (existed && snap) {
          const cols = Object.keys(snap).filter(
            (c) => c !== 'id' && c !== 'created_at' && c !== 'updated_at',
          );
          const setClause = cols.map((c, idx) => `"${c}" = $${idx + 3}`).join(', ');
          // node-postgres sends a JS array as a Postgres array, so jsonb values go as JSON text.
          const params = cols.map((c) =>
            snap[c] !== null && typeof snap[c] === 'object' && !(snap[c] instanceof Date)
              ? JSON.stringify(snap[c])
              : snap[c],
          );
          await client.query(
            `UPDATE public.starter_character_templates SET ${setClause} WHERE starter_campaign_id = $1 AND template_key = $2`,
            [t.campaign, t.key, ...params],
          );
        } else if (!existed) {
          await client.query(
            'DELETE FROM public.starter_character_templates WHERE starter_campaign_id = $1 AND template_key = $2',
            [t.campaign, t.key],
          );
        }
      }
      if (createdAcademy) {
        await client.query('DELETE FROM public.starter_campaigns WHERE id = $1', [
          ACADEMY_CAMPAIGN_ID,
        ]);
      }
      if (createdMidsummer) {
        await client.query('DELETE FROM public.starter_campaigns WHERE id = $1', [
          MIDSUMMER_CAMPAIGN_ID,
        ]);
      }
    } finally {
      await client.end();
    }
    await closeRealDb();
  });

  it('applies twice with expected values and unchanged control row', async () => {
    const controlBefore = await fetchRow(ACADEMY_CAMPAIGN_ID, 'the-herbalist');
    await runMigration();
    await runMigration();
    const g = await fetchRow(ACADEMY_CAMPAIGN_ID, 'the-gourmand');
    expect(g.subrace).toBe('Hill Dwarf');
    expect(g.ability_scores.WIS ?? g.ability_scores.wisdom).toBe(11);
    const sc = await fetchRow(ACADEMY_CAMPAIGN_ID, 'the-sous-chef');
    expect(sc.subclass).toBe('Draconic Bloodline');
    const ls = await fetchRow(MIDSUMMER_CAMPAIGN_ID, 'the-lovesick');
    expect(ls.subclass).toBe('Draconic Bloodline');
    const controlAfter = await fetchRow(ACADEMY_CAMPAIGN_ID, 'the-herbalist');
    expect(stripUpdatedAt(controlAfter)).toEqual(stripUpdatedAt(controlBefore));
  });

  it('lowercase-key gourmand becomes Hill Dwarf with wisdom 11', async () => {
    await updateRow(
      ACADEMY_CAMPAIGN_ID,
      'the-gourmand',
      'subrace = NULL, ability_scores = $3::jsonb',
      [
        JSON.stringify({
          strength: 16,
          dexterity: 12,
          constitution: 16,
          intelligence: 8,
          wisdom: 10,
          charisma: 10,
        }),
      ],
    );
    await runMigration();
    const g = await fetchRow(ACADEMY_CAMPAIGN_ID, 'the-gourmand');
    expect(g.subrace).toBe('Hill Dwarf');
    expect(g.ability_scores.wisdom).toBe(11);
  });

  it('hand-edited Mountain Dwarf gourmand is untouched', async () => {
    await updateRow(ACADEMY_CAMPAIGN_ID, 'the-gourmand', "subrace = 'Mountain Dwarf'", []);
    await runMigration();
    const g = await fetchRow(ACADEMY_CAMPAIGN_ID, 'the-gourmand');
    expect(g.subrace).toBe('Mountain Dwarf');
    expect(g.ability_scores.WIS ?? g.ability_scores.wisdom).toBe(10);
  });

  it('sorcerer with existing Wild Magic subclass is untouched', async () => {
    await updateRow(ACADEMY_CAMPAIGN_ID, 'the-sous-chef', "subclass = 'Wild Magic'", []);
    await runMigration();
    const sc = await fetchRow(ACADEMY_CAMPAIGN_ID, 'the-sous-chef');
    expect(sc.subclass).toBe('Wild Magic');
  });

  it('gourmand missing both keys raises', async () => {
    const client = new Client({ connectionString: realDbUrl });
    await client.connect();
    try {
      await client.query(
        `UPDATE public.starter_character_templates
         SET subrace = NULL, ability_scores = '{"STR":16}'::jsonb
         WHERE starter_campaign_id = $1 AND template_key = $2`,
        [ACADEMY_CAMPAIGN_ID, 'the-gourmand'],
      );
    } finally {
      await client.end();
    }
    await expect(runMigration()).rejects.toThrow();
    const sc = await fetchRow(ACADEMY_CAMPAIGN_ID, 'the-sous-chef');
    expect(sc.subclass).toBeNull();
    const ls = await fetchRow(MIDSUMMER_CAMPAIGN_ID, 'the-lovesick');
    expect(ls.subclass).toBeNull();
  });
});
