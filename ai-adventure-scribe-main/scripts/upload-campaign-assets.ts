#!/usr/bin/env bun
/**
 * Upload campaign assets to Supabase storage and link to database entities
 *
 * Usage:
 *   bun scripts/upload-campaign-assets.ts
 *   bun scripts/upload-campaign-assets.ts --campaign abyssal-descent
 *   bun scripts/upload-campaign-assets.ts --dry-run
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment variables
config();
config({ path: join(process.cwd(), 'server-bun/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ASSET_STAGING_DIR = '/var/www/infiniterealms/campaign-assets';
const BUCKET_NAME = 'campaign-images';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Asset {
  localPath: string;
  storagePath: string;
  campaignId: string;
  entityName: string;
  assetType: 'npc' | 'location' | 'item' | 'monster' | 'scene' | 'character';
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const campaignFilter = args.find((a) => a.startsWith('--campaign='))?.split('=')[1];

  console.log('🖼️  Campaign Asset Uploader');
  console.log('==========================\n');

  if (dryRun) console.log('⚠️  DRY RUN - No changes will be made\n');

  // Get campaign directories
  const campaigns = await readdir(ASSET_STAGING_DIR);
  const targetCampaigns = campaignFilter
    ? campaigns.filter((c) => c.includes(campaignFilter))
    : campaigns;

  if (targetCampaigns.length === 0) {
    console.log('No campaigns found in', ASSET_STAGING_DIR);
    return;
  }

  console.log(`📁 Found ${targetCampaigns.length} campaign(s) to process\n`);

  let totalUploaded = 0;
  let totalLinked = 0;

  for (const campaign of targetCampaigns) {
    const campaignPath = join(ASSET_STAGING_DIR, campaign);
    const stats = await stat(campaignPath);
    if (!stats.isDirectory()) continue;

    console.log(`\n📂 Processing: ${campaign}`);

    // Get all image files
    const files = await getImageFiles(campaignPath);
    console.log(`   Found ${files.length} image files`);

    for (const filePath of files) {
      const asset = parseAssetInfo(filePath, campaign);

      if (!dryRun) {
        // Upload to Supabase storage
        const uploaded = await uploadAsset(asset);
        if (uploaded) {
          totalUploaded++;

          // Link to database entity
          const linked = await linkAssetToEntity(asset);
          if (linked) totalLinked++;
        }
      } else {
        console.log(`   Would upload: ${asset.storagePath}`);
        console.log(`     → Link to: ${asset.assetType}:${asset.entityName}`);
      }
    }
  }

  console.log('\n==========================');
  console.log(`✅ Uploaded: ${totalUploaded} assets`);
  console.log(`🔗 Linked: ${totalLinked} entities`);
}

async function getImageFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getImageFiles(fullPath)));
    } else if (/\.(png|jpg|jpeg|webp|gif)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseAssetInfo(filePath: string, campaignId: string): Asset {
  const filename = basename(filePath, extname(filePath));
  const ext = extname(filePath);

  // Get parent directory name - might indicate asset type
  const parentDir = basename(join(filePath, '..'));

  let assetType: Asset['assetType'] = 'scene';
  let entityName = filename;

  // First, check if parent directory indicates asset type
  const dirTypeMap: Record<string, Asset['assetType']> = {
    characters: 'character',
    character: 'character',
    npcs: 'npc',
    npc: 'npc',
    locations: 'location',
    location: 'location',
    items: 'item',
    item: 'item',
    monsters: 'monster',
    monster: 'monster',
    creatures: 'monster',
    scenes: 'scene',
    scene: 'scene',
    backgrounds: 'scene',
    factions: 'npc', // Faction art often depicts leaders
  };

  const normalizedParentDir = parentDir.toLowerCase();
  if (dirTypeMap[normalizedParentDir]) {
    assetType = dirTypeMap[normalizedParentDir];
    entityName = filename.replace(/[-_]/g, ' ').trim();
  } else {
    // Fall back to filename prefix patterns
    const typePatterns: [RegExp, Asset['assetType']][] = [
      [/^npc[-_]/i, 'npc'],
      [/^location[-_]/i, 'location'],
      [/^item[-_]/i, 'item'],
      [/^monster[-_]/i, 'monster'],
      [/^character[-_]/i, 'character'],
      [/^scene[-_]/i, 'scene'],
    ];

    for (const [pattern, type] of typePatterns) {
      if (pattern.test(filename)) {
        assetType = type;
        entityName = filename.replace(pattern, '').replace(/[-_]/g, ' ').trim();
        break;
      }
    }

    // If still scene, just use filename
    if (assetType === 'scene') {
      entityName = filename.replace(/[-_]/g, ' ').trim();
    }
  }

  // Normalize campaign ID (remove spaces, lowercase)
  const normalizedCampaignId = campaignId.toLowerCase().replace(/\s+/g, '-');

  // Include asset type in storage path for organization
  const storagePath = `starter/${normalizedCampaignId}/${assetType}-${filename.toLowerCase().replace(/\s+/g, '-')}${ext.toLowerCase()}`;

  return {
    localPath: filePath,
    storagePath,
    campaignId: normalizedCampaignId,
    entityName: toTitleCase(entityName),
    assetType,
  };
}

function toTitleCase(str: string): string {
  return str
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

async function uploadAsset(asset: Asset): Promise<boolean> {
  try {
    const fileContent = await readFile(asset.localPath);
    const contentType = getContentType(asset.localPath);

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(asset.storagePath, fileContent, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error(`   ❌ Upload failed: ${asset.storagePath}`, error.message);
      return false;
    }

    console.log(`   ✅ Uploaded: ${asset.storagePath}`);
    return true;
  } catch (error) {
    console.error(`   ❌ Error uploading ${asset.storagePath}:`, error);
    return false;
  }
}

async function linkAssetToEntity(asset: Asset): Promise<boolean> {
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${asset.storagePath}`;

  // Try to find matching entity in campaign_chunks
  const { data: chunks, error } = await supabase
    .from('campaign_chunks')
    .select('id, entity_name, chunk_type, metadata')
    .eq('campaign_id', asset.campaignId)
    .ilike('entity_name', `%${asset.entityName}%`);

  if (error) {
    console.error(`   ❌ DB query failed:`, error.message);
    return false;
  }

  if (!chunks || chunks.length === 0) {
    console.log(`   ⚠️  No matching entity for: ${asset.entityName}`);
    return false;
  }

  // Update matching chunks with image URL
  for (const chunk of chunks) {
    const metadata = { ...((chunk.metadata as object) || {}), image_url: publicUrl };

    const { error: updateError } = await supabase
      .from('campaign_chunks')
      .update({ metadata })
      .eq('id', chunk.id);

    if (updateError) {
      console.error(`   ❌ Failed to update ${chunk.entity_name}:`, updateError.message);
    } else {
      console.log(`   🔗 Linked: ${chunk.entity_name} → ${asset.assetType}`);
    }
  }

  return true;
}

function getContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return types[ext] || 'application/octet-stream';
}

main().catch(console.error);
