#!/usr/bin/env bun
/**
 * Repair starter-flow characters created before starter seeding was complete.
 *
 * This script is intentionally manual. Run it with the service-role key after
 * reviewing the printed repair count; it never runs as part of migrations or
 * application startup.
 */

import { join } from 'path';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import { buildStarterCharacterSeed } from '../src/services/character/starter-character-seeding.ts';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

type StarterSession = { character_id: string | null; starter_campaign_id: string };
type CharacterRow = {
  id: string;
  name: string;
  race: string | null;
  subrace: string | null;
  class: string | null;
  level: number;
  background: string | null;
  cantrips: string | null;
  known_spells: string | null;
  image_url: string | null;
  avatar_url: string | null;
};
type TemplateRow = Record<string, unknown> & {
  starter_campaign_id: string;
  name: string;
  class: string;
  equipment?: string[];
};

function isEmpty(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function templateForCharacter(
  character: CharacterRow,
  campaignId: string,
  templates: TemplateRow[],
  stats: Record<string, number> | undefined,
): TemplateRow {
  const matchingTemplate = templates.find(
    (template) =>
      template.starter_campaign_id === campaignId &&
      template.name === character.name &&
      template.class.toLowerCase() === (character.class || '').toLowerCase(),
  );

  return (matchingTemplate || {
    starter_campaign_id: campaignId,
    name: character.name,
    race: character.race || 'Unknown',
    subrace: character.subrace,
    class: character.class || 'Fighter',
    level: character.level || 1,
    background: character.background,
    equipment: [],
    ability_scores: stats || {},
    skills: [],
    languages: [],
  }) as TemplateRow;
}

async function main(): Promise<void> {
  const { data: portraitRows, error: portraitReadError } = await supabase
    .from('characters')
    .select('id, image_url')
    .is('avatar_url', null)
    .not('image_url', 'is', null);
  if (portraitReadError) throw portraitReadError;
  for (const row of portraitRows || []) {
    const { error } = await supabase
      .from('characters')
      .update({ avatar_url: row.image_url })
      .eq('id', row.id)
      .is('avatar_url', null);
    if (error) throw error;
  }

  const { data: sessions, error: sessionError } = await supabase
    .from('game_sessions')
    .select('character_id, starter_campaign_id')
    .not('starter_campaign_id', 'is', null)
    .not('character_id', 'is', null);
  if (sessionError) throw sessionError;

  const starterSessions = (sessions || []) as StarterSession[];
  const characterIds = [
    ...new Set(starterSessions.map((row) => row.character_id).filter(Boolean)),
  ] as string[];
  if (characterIds.length === 0) {
    console.log(
      `Portrait backfill complete; no starter-flow characters found (avatars checked: ${portraitRows?.length ?? 0}).`,
    );
    return;
  }

  const campaignIds = [...new Set(starterSessions.map((row) => row.starter_campaign_id))];
  const [
    { data: characters, error: characterError },
    { data: templates, error: templateError },
    { data: equipmentInventory, error: equipmentInventoryError },
    { data: itemInventory, error: itemInventoryError },
    { data: stats, error: statsError },
  ] = await Promise.all([
    supabase
      .from('characters')
      .select(
        'id, name, race, subrace, class, level, background, cantrips, known_spells, image_url, avatar_url',
      )
      .in('id', characterIds),
    supabase.from('starter_character_templates').select('*').in('starter_campaign_id', campaignIds),
    supabase.from('character_equipment').select('character_id').in('character_id', characterIds),
    supabase.from('inventory_items').select('character_id').in('character_id', characterIds),
    supabase
      .from('character_stats')
      .select('character_id, strength, dexterity, constitution, intelligence, wisdom, charisma')
      .in('character_id', characterIds),
  ]);
  if (characterError) throw characterError;
  if (templateError) throw templateError;
  if (equipmentInventoryError) throw equipmentInventoryError;
  if (itemInventoryError) throw itemInventoryError;
  if (statsError) throw statsError;

  const inventoryIds = new Set([
    ...(equipmentInventory || []).map((row) => row.character_id),
    ...(itemInventory || []).map((row) => row.character_id),
  ]);
  const statsByCharacter = new Map(
    (stats || []).map((row) => [
      row.character_id,
      {
        strength: row.strength || 10,
        dexterity: row.dexterity || 10,
        constitution: row.constitution || 10,
        intelligence: row.intelligence || 10,
        wisdom: row.wisdom || 10,
        charisma: row.charisma || 10,
      },
    ]),
  );
  const templateRows = (templates || []) as TemplateRow[];
  const campaignByCharacter = new Map<string, string>();
  for (const session of starterSessions) {
    if (session.character_id)
      campaignByCharacter.set(session.character_id, session.starter_campaign_id);
  }

  let repaired = 0;
  for (const character of (characters || []) as CharacterRow[]) {
    if (
      inventoryIds.has(character.id) ||
      !isEmpty(character.cantrips) ||
      !isEmpty(character.known_spells)
    )
      continue;

    const campaignId = campaignByCharacter.get(character.id);
    if (!campaignId) continue;
    const template = templateForCharacter(
      character,
      campaignId,
      templateRows,
      statsByCharacter.get(character.id),
    );
    const hasEquipment = Array.isArray(template.equipment) && template.equipment.length > 0;
    const classShouldHaveCantrips = [
      'bard',
      'cleric',
      'druid',
      'sorcerer',
      'warlock',
      'wizard',
    ].includes(template.class.toLowerCase());
    if (!hasEquipment && !classShouldHaveCantrips) continue;

    const seed = buildStarterCharacterSeed(template, campaignId);
    const equipment = seed.equipment;
    const { error: updateError } = await supabase
      .from('characters')
      .update({
        cantrips: seed.cantrips,
        known_spells: seed.known_spells,
        prepared_spells: seed.prepared_spells,
        spell_slots: seed.spell_slots,
        total_level: seed.total_level,
        avatar_url: character.avatar_url || character.image_url,
      })
      .eq('id', character.id);
    if (updateError) throw updateError;

    if (Array.isArray(equipment) && equipment.length > 0) {
      const { error: equipmentError } = await supabase
        .from('character_equipment')
        .insert(equipment.map((item) => ({ character_id: character.id, ...item })));
      if (equipmentError) throw equipmentError;
    }
    repaired += 1;
  }

  console.log(`Starter character backfill complete: repaired ${repaired} character(s).`);
}

void main().catch((error) => {
  console.error('Starter character backfill failed:', error);
  process.exit(1);
});
