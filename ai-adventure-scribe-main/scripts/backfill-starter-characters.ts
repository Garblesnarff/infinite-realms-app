#!/usr/bin/env bun
/* eslint-disable max-lines */
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

import {
  normalizeEquipmentLookupKey,
  resolveEquipmentByName,
} from '../src/data/equipment/resolver.ts';
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
  equipment?: Array<string | { name: string; description?: string | null }>;
};
type ExistingEquipmentRow = {
  id: string;
  character_id: string;
  item_name: string;
  item_type: string | null;
  quantity: number | null;
};
type ExistingInventoryRow = {
  character_id: string;
  name: string;
  item_type: string;
  quantity: number;
};

function isEmpty(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function equipmentIdentity(name: string): string {
  const resolved = resolveEquipmentByName(name);
  return resolved ? `srd:${resolved.id}` : `custom:${normalizeEquipmentLookupKey(name)}`;
}

function hasEquipmentRow(
  rows: ExistingEquipmentRow[],
  name: string,
): ExistingEquipmentRow | undefined {
  const identity = equipmentIdentity(name);
  return rows.find((row) => equipmentIdentity(row.item_name) === identity);
}

function hasInventoryRow(
  rows: ExistingInventoryRow[],
  name: string,
): ExistingInventoryRow | undefined {
  return rows.find(
    (row) => normalizeEquipmentLookupKey(row.name) === normalizeEquipmentLookupKey(name),
  );
}

function isTrinketType(itemType: string | null | undefined): boolean {
  return itemType === 'custom' || itemType === 'trinket';
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
    supabase
      .from('character_equipment')
      .select('id, character_id, item_name, item_type, quantity')
      .in('character_id', characterIds),
    supabase
      .from('inventory_items')
      .select('character_id, name, item_type, quantity')
      .in('character_id', characterIds),
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

  const equipmentRows = (equipmentInventory || []) as ExistingEquipmentRow[];
  const inventoryRows = (itemInventory || []) as ExistingInventoryRow[];
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
    if (!hasEquipment && !classShouldHaveCantrips && !isEmpty(character.cantrips)) continue;

    const seed = buildStarterCharacterSeed(template, campaignId);
    const equipment = (seed.equipment || []) as Array<Record<string, unknown>>;
    const existingEquipment = equipmentRows.filter((row) => row.character_id === character.id);
    const existingInventory = inventoryRows.filter((row) => row.character_id === character.id);

    // Starter rows created before the resolver aliases were added were stored
    // as custom/trinket. Canonicalize those rows in place so rerunning this
    // script is safe and never resets an existing quantity.
    for (const existing of existingEquipment) {
      if (!isTrinketType(existing.item_type)) continue;
      const resolved = resolveEquipmentByName(existing.item_name);
      if (!resolved) continue;
      if (existing.item_name === resolved.name && existing.item_type === resolved.category) {
        continue;
      }

      const { error } = await supabase
        .from('character_equipment')
        .update({ item_name: resolved.name, item_type: resolved.category })
        .eq('id', existing.id);
      if (error) throw error;
      existing.item_name = resolved.name;
      existing.item_type = resolved.category;
    }

    const missingEquipment = equipment.filter((item) => {
      const existing = hasEquipmentRow(existingEquipment, String(item.item_name || ''));
      return !existing;
    });

    for (const item of equipment) {
      if (!isTrinketType(String(item.item_type || ''))) continue;
      const existing = hasEquipmentRow(existingEquipment, String(item.item_name || ''));
      if (existing && existing.item_type !== item.item_type) {
        const { error } = await supabase
          .from('character_equipment')
          .update({ item_type: item.item_type })
          .eq('id', existing.id);
        if (error) throw error;
        existing.item_type = String(item.item_type);
      }
    }

    if (missingEquipment.length > 0) {
      const { error: equipmentError } = await supabase.from('character_equipment').insert(
        missingEquipment.map((item) => ({
          character_id: character.id,
          item_name: item.item_name,
          item_type: item.item_type,
          quantity: item.quantity,
          equipped: item.equipped,
        })),
      );
      if (equipmentError) throw equipmentError;
    }

    const inventoryItems = (seed.inventory_items || []) as Array<Record<string, unknown>>;
    const missingInventory = inventoryItems.filter(
      (item) => !hasInventoryRow(existingInventory, String(item.name || '')),
    );
    if (missingInventory.length > 0) {
      const { error: inventoryError } = await supabase
        .from('inventory_items')
        .insert(missingInventory.map((item) => ({ character_id: character.id, ...item })));
      if (inventoryError) throw inventoryError;
    }

    const characterPatch: Record<string, unknown> = {
      avatar_url: character.avatar_url || character.image_url,
      total_level: seed.total_level,
    };
    if (isEmpty(character.cantrips)) characterPatch.cantrips = seed.cantrips;
    if (isEmpty(character.known_spells)) characterPatch.known_spells = seed.known_spells;
    if (isEmpty(character.cantrips) || isEmpty(character.known_spells)) {
      characterPatch.prepared_spells = seed.prepared_spells;
      characterPatch.spell_slots = seed.spell_slots;
    }
    const shouldUpdateCharacter =
      missingEquipment.length > 0 ||
      missingInventory.length > 0 ||
      isEmpty(character.cantrips) ||
      isEmpty(character.known_spells) ||
      !character.avatar_url;
    if (shouldUpdateCharacter) {
      const { error: updateError } = await supabase
        .from('characters')
        .update(characterPatch)
        .eq('id', character.id);
      if (updateError) throw updateError;
      repaired += 1;
    }
  }

  console.log(`Starter character backfill complete: repaired ${repaired} character(s).`);
}

void main().catch((error) => {
  console.error('Starter character backfill failed:', error);
  process.exit(1);
});
