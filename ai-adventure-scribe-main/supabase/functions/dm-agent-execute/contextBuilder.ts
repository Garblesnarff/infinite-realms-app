import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { AgentContext, CampaignContext, CharacterContext, StarterCampaignContext, StarterCampaignRule } from './types.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Calculates ability score modifier
 */
const calculateModifier = (score: number): number => Math.floor((score - 10) / 2);

/**
 * Fetches and builds character context
 */
export async function buildCharacterContext(characterId: string): Promise<CharacterContext | null> {
  try {
    const { data: characterData, error } = await supabase
      .from('characters')
      .select(`
        *,
        character_stats!inner(*),
        character_equipment(*)
      `)
      .eq('id', characterId)
      .single();

    if (error) throw error;
    if (!characterData) return null;

    return {
      name: characterData.name,
      race: characterData.race,
      class: characterData.class,
      level: characterData.level,
      background: characterData.background,
      description: characterData.description,
      alignment: characterData.alignment,
      hitPoints: {
        current: characterData.character_stats.current_hit_points,
        max: characterData.character_stats.max_hit_points,
        temporary: characterData.character_stats.temporary_hit_points
      },
      abilityScores: {
        strength: { 
          score: characterData.character_stats.strength,
          modifier: calculateModifier(characterData.character_stats.strength)
        },
        dexterity: { 
          score: characterData.character_stats.dexterity,
          modifier: calculateModifier(characterData.character_stats.dexterity)
        },
        constitution: { 
          score: characterData.character_stats.constitution,
          modifier: calculateModifier(characterData.character_stats.constitution)
        },
        intelligence: { 
          score: characterData.character_stats.intelligence,
          modifier: calculateModifier(characterData.character_stats.intelligence)
        },
        wisdom: { 
          score: characterData.character_stats.wisdom,
          modifier: calculateModifier(characterData.character_stats.wisdom)
        },
        charisma: { 
          score: characterData.character_stats.charisma,
          modifier: calculateModifier(characterData.character_stats.charisma)
        }
      },
      armorClass: characterData.character_stats.armor_class,
      initiative: characterData.character_stats.initiative_bonus,
      speed: characterData.character_stats.speed,
      equipment: characterData.character_equipment.map((item: any) => ({
        name: item.item_name,
        type: item.item_type,
        equipped: item.equipped,
        quantity: item.quantity
      }))
    };
  } catch (error) {
    console.error('Error building character context:', error);
    return null;
  }
}

/**
 * Fetches and builds campaign context
 */
export async function buildCampaignContext(campaignId: string): Promise<CampaignContext | null> {
  try {
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (error) throw error;
    if (!campaign) return null;

    return {
      name: campaign.name,
      genre: campaign.genre || 'fantasy',
      difficulty_level: campaign.difficulty_level || 'medium',
      tone: campaign.tone || 'serious',
      description: campaign.description,
      setting_details: campaign.setting_details || {}
    };
  } catch (error) {
    console.error('Error building campaign context:', error);
    return null;
  }
}

/**
 * Fetches and builds starter campaign context (canonical lore)
 * Called when a session is linked to a starter_campaign_id
 */
export async function buildStarterCampaignContext(starterCampaignId: string): Promise<StarterCampaignContext | null> {
  try {
    // Fetch the starter campaign with overview and creative brief
    const { data: campaign, error: campaignError } = await supabase
      .from('starter_campaigns')
      .select('id, title, overview, creative_brief')
      .eq('id', starterCampaignId)
      .single();

    if (campaignError) {
      console.error('[StarterCampaign] Error fetching campaign:', campaignError);
      return null;
    }
    if (!campaign) {
      console.log('[StarterCampaign] No campaign found for id:', starterCampaignId);
      return null;
    }

    // Fetch campaign rules (causality, mechanics, world laws)
    const { data: rulesData, error: rulesError } = await supabase
      .from('campaign_rules')
      .select('rule_type, condition, effect, reversible, priority')
      .eq('campaign_id', starterCampaignId)
      .order('priority', { ascending: false });

    if (rulesError) {
      console.error('[StarterCampaign] Error fetching rules:', rulesError);
    }

    const rules: StarterCampaignRule[] = (rulesData || []).map((r: any) => ({
      ruleType: r.rule_type,
      condition: r.condition,
      effect: r.effect,
      reversible: r.reversible,
      priority: r.priority
    }));

    console.log(`[StarterCampaign] Loaded "${campaign.title}" with ${rules.length} rules`);

    return {
      id: campaign.id,
      title: campaign.title,
      overview: campaign.overview,
      creativeBrief: campaign.creative_brief,
      rules
    };
  } catch (error) {
    console.error('[StarterCampaign] Error building context:', error);
    return null;
  }
}