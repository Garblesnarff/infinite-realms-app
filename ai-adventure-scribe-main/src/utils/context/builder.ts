import { createDefaultContext } from './contextDefaults';

import type { ThematicElements } from '@/types/campaign';
import type { GameContext } from '@/types/game';
import type { Memory } from '@/types/memory';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

interface ContextParams {
  campaignId: string;
  characterId: string;
  sessionId: string;
}

class GameContextBuilder {
  private async fetchCampaign(campaignId: string): Promise<CampaignRow | null> {
    // ⚡ Bolt: Optimized to select only required columns and use explicit selection for joined relations
    // (worlds, quests) to reduce over-fetching and minimize payload size.
    const [campaign, worldsResult, questsResult] = await Promise.all([
      userDataApi.getCampaign(campaignId),
      supabase.from('worlds').select('id, name, description').eq('campaign_id', campaignId),
      supabase
        .from('quests')
        .select('id, title, description, status')
        .eq('campaign_id', campaignId),
    ]);
    if (worldsResult.error) throw worldsResult.error;
    if (questsResult.error) throw questsResult.error;
    return { ...campaign, worlds: worldsResult.data, quests: questsResult.data } as CampaignRow;
  }

  private async fetchCharacter(characterId: string): Promise<CharacterRow | null> {
    // ⚡ Bolt: Optimized to select only required columns and relations with explicit selection for nested objects.
    // This reduces database load and data transfer while maintaining all required context data.
    const [character, equipmentResult, questResult] = await Promise.all([
      userDataApi.getCharacter(characterId),
      supabase
        .from('character_equipment')
        .select('item_name, item_type, description, equipped')
        .eq('character_id', characterId),
      supabase
        .from('quest_progress')
        .select('status, updated_at, quests(title)')
        .eq('character_id', characterId),
    ]);
    if (equipmentResult.error) throw equipmentResult.error;
    if (questResult.error) throw questResult.error;
    return {
      ...character,
      character_equipment: equipmentResult.data,
      quest_progress: questResult.data,
    } as CharacterRow;
  }

  private async fetchMemories(sessionId: string): Promise<Memory[] | null> {
    return userDataApi.listMemories(sessionId, { limit: 15 }) as Promise<Memory[]>;
  }

  private compose(
    campaignResult: PromiseSettledResult<CampaignRow | null>,
    characterResult: PromiseSettledResult<CharacterRow | null>,
    memoryResult: PromiseSettledResult<Memory[] | null>,
  ): GameContext {
    const context = createDefaultContext();

    if (campaignResult.status === 'fulfilled' && campaignResult.value) {
      const campaign = campaignResult.value;
      const thematicElements = (campaign.thematic_elements || {}) as ThematicElements;
      context.campaign = {
        basic: {
          name: campaign.name,
          description: campaign.description,
          genre: campaign.genre,
          status: campaign.status || 'active',
        },
        setting: {
          era: campaign.era || 'unknown',
          location: campaign.location || 'unspecified',
          atmosphere: campaign.atmosphere || 'neutral',
        },
        thematicElements,
      };
    }

    if (characterResult.status === 'fulfilled' && characterResult.value) {
      const character = characterResult.value;
      const stats = character.character_stats?.[0] || ({} as CharacterStatsRow);
      context.character = {
        basic: {
          name: character.name,
          race: character.race,
          class: character.class,
          level: character.level || 1,
        },
        stats: {
          health: {
            current: stats.current_hit_points || 10,
            max: stats.max_hit_points || 10,
            temporary: 0,
          },
          armorClass: stats.armor_class || 10,
          abilities: {
            strength: stats.strength || 10,
            dexterity: stats.dexterity || 10,
            constitution: stats.constitution || 10,
            intelligence: stats.intelligence || 10,
            wisdom: stats.wisdom || 10,
            charisma: stats.charisma || 10,
          },
        },
        equipment: (character.character_equipment || []).map((item: CharacterEquipmentRow) => ({
          name: item.item_name,
          type: formatEquipmentContextType(item),
          equipped: item.equipped || false,
        })),
      };
    }

    if (memoryResult.status === 'fulfilled' && memoryResult.value) {
      const memories = memoryResult.value as Memory[];
      context.memories = {
        recent: memories.filter((m) => m.type === 'event').slice(0, 5),
        locations: memories.filter((m) => m.type === 'location'),
        characters: memories.filter((m) => m.type === 'npc'),
        plot: memories.filter((m) => m.type === 'plot_point'),
      };
    }

    return context;
  }

  public async build(params: ContextParams): Promise<GameContext> {
    try {
      const [campaign, character, memories] = await Promise.allSettled([
        this.fetchCampaign(params.campaignId),
        this.fetchCharacter(params.characterId),
        this.fetchMemories(params.sessionId),
      ]);

      return this.compose(campaign, character, memories);
    } catch (error) {
      logger.error('[GameContextBuilder] Error building context:', error);
      return createDefaultContext();
    }
  }
}

export const gameContextBuilder = new GameContextBuilder();

// Minimal row shapes used internally for type safety
interface CampaignRow {
  id: string;
  name: string;
  description?: string | null;
  genre?: string | null;
  status?: string | null;
  era?: string | null;
  location?: string | null;
  atmosphere?: string | null;
  thematic_elements?: Partial<ThematicElements> | null;
}

interface CharacterStatsRow {
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;
  current_hit_points?: number;
  max_hit_points?: number;
  armor_class?: number;
}

interface CharacterEquipmentRow {
  item_name: string;
  item_type?: string;
  description?: string | null;
  equipped?: boolean;
}

interface CharacterRow {
  id: string;
  name: string;
  race?: string | null;
  class?: string | null;
  level?: number | null;
  character_stats?: CharacterStatsRow[] | null;
  character_equipment?: CharacterEquipmentRow[] | null;
}

export function formatEquipmentContextType(item: CharacterEquipmentRow): string {
  if (item.item_type === 'trinket' || item.item_type === 'custom') {
    return `${item.item_name}${item.description?.trim() ? ` (${item.description.trim()})` : ''}`;
  }
  return item.item_type || 'equipment';
}
