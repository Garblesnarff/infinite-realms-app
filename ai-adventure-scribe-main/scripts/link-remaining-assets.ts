#!/usr/bin/env bun
/**
 * Link remaining unlinked assets to entities using fuzzy matching
 */

import { join } from 'path';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET_NAME = 'campaign-images';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Manual mappings for known mismatches
const MANUAL_MAPPINGS: Record<string, string[]> = {
  // Abyssal Descent
  'character-dr-aris-thorne': ['Dr. Aris Thorne'],
  'character-iron-jawn': ['"Iron" Jawn'],
  'character-rat-kincaid': ['"Rat" Kincaid'],
  'character-the-stitch-master': ['The Stitch-Master'],
  'character-valerius-the-upside-down': ['Valerius'],
  'character-space-lord-vex': ['Spore-Lord Vex'],
  'character-the-faceless-stalker': ['The Faceless Stalker'],
  'character-the-silent-monk': ['The Silent Monk'],
  'character-blind-cathedral-survivor': ['Blind Cathedral'],
  'character-myco-infected-miner': ['Myco-Saints', 'Compromised'],
  'character-screaming-gallery-victim': ['Screaming Gallery'],
  'location-the-apeture': ['The Aperture'],
  'location-the-bell-tower': ['Bell-Tower', 'Bell Tower'],
  'location-the-blind-cathedral': ['Blind Cathedral', 'Ossuary of Silence'],
  'location-the-flesh-gardens': ['Flesh-Gardens', 'Flesh Gardens'],
  'location-the-inverted-halls': ['Inverted Halls', 'Möbius Shaft'],
  'location-the-null-point': ['Null-Point', 'Null Point'],
  'location-the-mouth-of-truth-copy': ['Mouth of Truth'],
  'item-the-exit-key': ['Exit Key', 'Door to Nowhere'],
  'item-the-gravity-anchor': ['Gravity Anchor'],
  'item-the-screaming-stone': ['Screaming Stone'],
  'item-the-sun-drop-lantern': ['Sun-Drop Lantern', 'Sundrop'],
  'monster-the-chiropteran-hulk': ['Chiropteran'],
  'monster-the-deep-angler': ['Deep Angler'],
  'monster-the-gravity-golem': ['Gravity Golem'],
  'monster-the-light-eater': ['Light Eater', 'Light-Eater'],
  'monster-the-thing-below': ['Thing Below'],
  'monster-the-vitruvian-spider': ['Vitruvian Spider'],

  // The Eternal Feast - Characters
  'character-chef-gorgon-ramsey': ['Gorgonzola the Stinky', 'Gorgon'],
  'character-chef-mordants-sious-chef': ['Chef Mordant', 'Mordant'],
  'character-head-chef-balthazar': ['Balthazar'],
  'character-lady-nova': ['Lady Glaze', 'Saint Celestia'],
  'character-lord-diablo': ['Lord Diabolo', 'Diabolo'],
  'character-lord-zest': ['Sir Loin'],
  'character-cask': ['Vintage'],
  'character-quill': ['Flicker', 'Sweetness'],
  'character-elara-void-whisper': ['Whisper', 'The Wanderer'],
  'character-the-doorkeeper': ['Doorkeeper'],
  'character-the-inspector': ['Remy', 'The Manager'],
  'character-the-star-crossed-lovers': ['Dragon Goldscale', 'Madame Mushroom'],
  // The Eternal Feast - Locations
  'location-empyrea': ['Dining Dimensions', 'Prep Islands'],
  'location-erebus': ['Root Cellar', 'Sapper'],
  'location-gelida-glades': ['Gelida Glades', 'Ice'],
  'location-main-dining-hall': ['Main Floor'],
  'location-mechanis-abattoir': ['Sauce Vats', 'Under-Booth'],
  'location-oneiros-orchards': ['Oneiros Orchards', 'Dream'],
  'location-pandemonium': ['Infernus Market', 'Fire'],
  'location-thanatos-fields': ['Thanatos Fields', 'Death'],
  'location-the-alleyway-door': ['Sapper', 'Tunnel'],
  'location-the-aquarium-room': ['Aquarium Room'],
  'location-the-deep-freezer': ['Zero-Kelvin', 'Walk-in'],
  'location-the-door-of-locks': ['Door of Locks'],
  'location-the-dungeon-door': ['Root Cellar'],
  'location-the-forest-door': ['Ingredient Worlds', 'Outposts'],
  'location-the-heat-line': ['Heat Line'],
  'location-the-high-altitude-terrace': ['High-Altitude Terrace'],
  'location-the-hunger-between-worlds': ['Void-Maw'],
  'location-the-infinite-wine-cellar': ['Wine Library', 'Cellar'],
  'location-the-kitchen': ['Infinite Kitchen'],
  'location-the-last-supper': ['Dining Dimensions'],
  'location-the-seal-broken': ['Cellar & Seal'],
  'location-the-vip-void': ['Under-Booth'],
  'location-the-wine-library': ['Wine Library'],
  'location-the-zero-g-hydroponics-garden': ['Prep Islands'],
  'location-void-tavern': ['Main Floor'],
  // The Eternal Feast - Items
  'item-badge-brigade-of-the-eternal-flame': ['Garlic of Exorcism'],
  'item-badge-order-of-the-geometrists': ['Fork of Truth'],
  'item-badge-the-weeping-spoons': ['Spoon of Scooping'],
  'item-chefs-hat-of-ego': ["Chef's Hat of Ego"],
  'item-mug-of-yesterday': ['Mug of "Yesterday"', 'Yesterday'],
  'item-nebula-chowder': ['Soup of Stone'],
  'item-pheonix-eggs': ['Dragon-Chili', 'Ghost-Pepper'],
  'item-roasted-hydra-brisket': ['Self-Cutting Steak'],
  'item-sazons-cleaver': ["Sazón's Cleaver"],
  'item-sazons-journal': ['Plate of Warning'],
  'item-soul-wine': ['Bottomless Mug'],
  'item-the-black-sludge': ['Bread of Sorrow'],
  'item-the-bottle-of-year-zero': ['Salt of Preservation'],
  'item-the-broken-seal-fragment': ['Cellar & Seal'],
  'item-the-dimensional-cleaver': ["Sazón's Cleaver", 'Knife of Toasting'],
  'item-the-dish-of-reconciliation': ['Screaming Cheese'],
  'item-the-golden-star': ['Levitating Lettuce'],
  'item-the-invisibility-napkin': ['Invisibility Napkin'],
  'item-the-table-cloth-of-hosting': ['Plate of Warning'],
  'item-time-honey': ['Ghost-Pepper'],
  'item-wish-fruit': ['Levitating Lettuce'],
  // The Eternal Feast - Monsters (entities may not exist for all)
  'monster-alcohol-ooze': ['Bottomless Mug'],
  'monster-chili-pepper-imps': ['Ghost-Pepper', 'Dragon-Chili'],
  'monster-chrono-weevil': ['Unit 734'],
  'monster-crustacean-teleporter': ['Dishwasher Prime'],
  'monster-freezer-burn-elemental': ['Zero-Kelvin'],
  'monster-ice-mephit': ['Gelida Glades'],
  'monster-magmin': ['Infernus Market'],
  'monster-shadow-roach': ['The Old Man'],
  'monster-sourdough-golem': ['Bread of Sorrow'],
  'monster-the-hunger-spawn-minions': ['Void-Maw'],
  'monster-the-rot-maw': ['Void-Maw'],
  'monster-the-spice-drake': ['Dragon Goldscale'],
  'monster-the-unwashed-dish': ['Dishwasher Prime'],
  'monster-the-void-shark': ['Void-Maw'],
  'monster-vegan-lich': ['Madame Mushroom'],
  'monster-void-maw-cultist': ['Void-Maw'],

  // Academy of Arcane Gastronomy
  // Characters
  'character-the-bland-one': ['The Bland One'],
  'character-the-divine-taster': ['The Divine Taster'],
  'character-the-spice-merchant': ['The Spice Merchant', 'Spice Merchant'],
  'character-the-master-theif': ['The Master Thief'],
  'character-the-umami-overlord': ['The Umami Overlord'],
  'character-headmaster': ['Grand Chef Sazón', 'Chef Ambrosius'],
  'character-guidance-counselor': ['The Divine Taster', 'The Palate of Judgment'],
  'character-rival-student': ['The Culinary Critic', 'The Recipe Hunter'],
  'character-the-rot-weaver': ['The Rot Weaver'],

  // Locations
  'location-the-first-palates-realm': ["The First Palate's Realm", 'First Palate'],
  'location-the-flavor-vault': ['Flavor-Vault', 'Flavor Vault'],
  'location-the-flavor-drainer': ['Flavor-Drainer', 'Flavor Drainer'],
  'location-the-elemental-arena': ['Flavor-Elemental Arena', 'Elemental Arena'],
  'location-cooking-arena': ['Flavor-Elemental Arena', 'Elemental Arena'],
  'location-the-monotonys-ash-waste': ['Ash Wastes', "Monotony's Domain"],
  'location-dining-hall': ['Grand Kitchen'],
  'location-the-grand-larder': ['Grand Kitchen', 'Grand Larder'],
  'location-the-academy-grounds-map': ['Academy of Arcane Gastronomy'],
  'location-the-academy-library': ['Academy Library'],
  'location-classroom-keyframe': ['Academy Library', 'Academy of Arcane'],
  'location-dormitory-of-delights': ['Sweet Tooth', 'Sugar Queen'],
  'location-the-umami-meditation-hall': ['Umami Collective', 'Umami Philosopher'],
  'location-the-undercroft-pantries': ['Bitter End', 'Bitter Canyons'],
  'location-the-flavor-verse-cosmology': ['First Palate', 'Monotony'],

  // Items
  'item-the-ever-empty-salt-shaker': ['Ever-Empty Salt Shaker'],
  'item-fragment-of-the-recipe-of-immortality': ['Recipe of Immortality'],
  'item-the-anti-flavor-spoon': ["Monotony's Anti-Spoon", 'Anti-Spoon'],
  'item-the-essence-of-pure-joy': ['Tears of Pure Joy', 'Pure Joy'],
  'item-bottle-of-tears-of-pure-joy': ['Tears of Pure Joy', 'Pure Joy'],
  'item-the-vorpal-cleaver': ['Golden Spoon of Sazón', 'Vorpal'],
  'item-the-golden-spoon': ['Golden Spoon of Sazón'],
  'item-whispering-mint-leaves': ['Whispers Secrets', 'Whispering'],
  'item-the-codex-of-forbidden-flavors': ['Bitter Pill', 'Recipe for Disaster'],
  'item-the-memory-spoon': ['Memory Spoon', 'Self-Stirring'],
  'item-the-merchants-ledger': ['Spice Merchant', 'Merchant'],
  'item-phoenix-fire-noodle-bowl': ['Harmonious Fork', 'First Palate'],
  'item-the-bland-ones-inner-sanctum': ['Bland One'],

  // Monsters
  'monster-flavor-elemental': ['Flavor-Elemental', 'Flavor Elemental'],
  'monster-the-meringue-golem': ['Meringue Golem', 'Sugar Golem'],
  'monster-sugar-golem': ['Sugar Golem'],
  'monster-the-recipe-theif': ['Recipe Thief', 'Recipe Thieves'],
  'monster-spice-lord-thug': ['Spice Lords', 'Spice Merchant', 'Pepper King'],

  // Additional Eternal Feast character mappings (alternate filenames)
  'character-dishwasher-prime': ['Dishwasher Prime'],
  'character-dragon-goldscale': ['Dragon Goldscale'],
  'character-remy': ['Remy', 'The Manager'],
  'character-sir-loin': ['Sir Loin'],
  'character-whisper': ['Whisper'],

  // Additional Eternal Feast item mappings (alternate filenames)
  'item-bread-of-sorrow': ['Bread of Sorrow'],
  'item-salt-of-preservation': ['Salt of Preservation'],
  'item-screaming-cheese': ['Screaming Cheese'],
  'item-soup-of-stone': ['Soup of Stone'],
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('🔗 Asset Linker (Fuzzy Matching)');
  console.log('================================\n');
  if (dryRun) console.log('⚠️  DRY RUN\n');

  // Get all assets
  const { data: assets, error: assetsError } = await supabase.storage
    .from(BUCKET_NAME)
    .list('starter', { limit: 500 });

  if (assetsError) {
    console.error('Error listing assets:', assetsError);
    return;
  }

  // Get all campaign folders
  const _campaigns = assets?.filter((a) => a.id === null) || []; // folders have null id

  let linked = 0;
  let skipped = 0;

  for (const campaign of ['abyssal-descent', 'the-eternal-feast', 'academy-of-arcane-gastronomy']) {
    console.log(`\n📂 ${campaign}`);

    const { data: files } = await supabase.storage.from(BUCKET_NAME).list(`starter/${campaign}`);

    if (!files) continue;

    for (const file of files) {
      if (!file.name.match(/\.(png|jpg|jpeg|webp|gif)$/i)) continue;

      const assetKey = file.name.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '');
      const storagePath = `starter/${campaign}/${file.name}`;
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${storagePath}`;

      // Check if already linked
      const { data: existing } = await supabase
        .from('campaign_chunks')
        .select('id')
        .eq('campaign_id', campaign)
        .ilike('metadata->>image_url', `%${file.name}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        continue; // Already linked
      }

      // Try manual mapping first
      const searchTerms = MANUAL_MAPPINGS[assetKey];
      if (!searchTerms) {
        skipped++;
        continue;
      }

      let foundMatch = false;
      for (const term of searchTerms) {
        const { data: chunks } = await supabase
          .from('campaign_chunks')
          .select('id, entity_name, chunk_type')
          .eq('campaign_id', campaign)
          .ilike('entity_name', `%${term}%`);

        if (chunks && chunks.length > 0) {
          if (dryRun) {
            console.log(`   Would link: ${assetKey} → ${chunks[0].entity_name}`);
          } else {
            for (const chunk of chunks) {
              const { error } = await supabase
                .from('campaign_chunks')
                .update({
                  metadata: { image_url: publicUrl },
                })
                .eq('id', chunk.id);

              if (!error) {
                console.log(`   ✅ ${assetKey} → ${chunk.entity_name}`);
                linked++;
              }
            }
          }
          foundMatch = true;
          break;
        }
      }

      if (!foundMatch) {
        console.log(`   ⚠️  No match for ${assetKey} (tried: ${searchTerms.join(', ')})`);
        skipped++;
      }
    }
  }

  console.log('\n================================');
  console.log(`✅ Linked: ${linked}`);
  console.log(`⏭️  Skipped: ${skipped}`);
}

main().catch(console.error);
