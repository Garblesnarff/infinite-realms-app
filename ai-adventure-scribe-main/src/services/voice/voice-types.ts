/**
 * Voice settings for ElevenLabs synthesis
 */
export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

/**
 * Configuration for a specific voice
 */
export interface VoiceConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  settings: VoiceSettings;
  category: 'narrator' | 'hero' | 'villain' | 'creature' | 'npc' | 'child' | 'elder';
}
