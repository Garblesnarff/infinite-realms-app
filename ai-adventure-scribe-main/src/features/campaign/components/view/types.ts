export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  genre: string | null;
  difficulty_level: string | null;
  campaign_length: string | null;
  tone: string | null;
  era: string | null;
  location: string | null;
  atmosphere: string | null;
  background_image?: string | null;
}

export interface CharacterListItem {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number | null;
  avatar_url?: string | null;
  background_image?: string | null;
  character_stats?: {
    strength?: number;
    dexterity?: number;
    constitution?: number;
    intelligence?: number;
    wisdom?: number;
    charisma?: number;
    armor_class?: number;
    max_hit_points?: number;
  };
}
