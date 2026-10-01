import type { VoiceConfig } from '../voice-routing';

/**
 * Interface for voice pools.
 *
 * The pools are iterated as a string-keyed record (Object.entries), so the
 * index signature keeps `Object.entries(VOICE_POOLS)` precisely typed instead
 * of degrading to `[string, any][]`. (#2313)
 */
export interface VoicePool extends Record<string, VoiceConfig[]> {
  dm: VoiceConfig[];
  heroes: VoiceConfig[];
  npcs: VoiceConfig[];
  villains: VoiceConfig[];
  creatures: VoiceConfig[];
}

/**
 * Simplified voice pools - fewer options, clearer choices
 */
export const VOICE_POOLS: VoicePool = {
  dm: [
    {
      id: 'T0GKiSwCb51L7pv1sshd', // Same voice ID the removed AudioPlayer used
      name: 'DM Voice',
      description: 'Main DM narrator voice (old compatible)',
      settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    } as VoiceConfig,
  ],

  heroes: [
    {
      id: 'GBv7mTt0atIp3Br8iCZE', // Thomas
      name: 'Thomas',
      description: 'Noble male hero voice',
      settings: {
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
      },
    } as VoiceConfig,
    {
      id: 'BlgEcC0TfWpBak7FmvHW', // Fena
      name: 'Fena',
      description: 'Young female hero voice',
      settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    } as VoiceConfig,
  ],

  npcs: [
    {
      id: 'pMsXgVXv3BLzUgSXRplE', // Serena
      name: 'Serena',
      description: 'Warm innkeeper voice',
      settings: {
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
      },
    } as VoiceConfig,
    {
      id: 'g2W4HAjKvdW93AmsjsOx', // Nathan
      name: 'Nathan',
      description: 'Friendly merchant voice',
      settings: {
        stability: 0.4,
        similarity_boost: 0.8,
        style: 0.4,
        use_speaker_boost: true,
      },
    } as VoiceConfig,
    {
      id: 'yoZ06aMxZJJ28mfd3POQ', // Sam
      name: 'Sam',
      description: 'Wise elder voice',
      settings: {
        stability: 0.8,
        similarity_boost: 0.8,
        style: 0.1,
        use_speaker_boost: true,
      },
    } as VoiceConfig,
  ],

  villains: [
    {
      id: '2gPFXx8pN3Avh27Dw5Ma', // Oxley
      name: 'Oxley',
      description: 'Ominous male villain voice',
      settings: {
        stability: 0.7,
        similarity_boost: 0.9,
        style: 0.4,
        use_speaker_boost: true,
      },
    } as VoiceConfig,
    {
      id: 'flHkNRp1BlvT73UL6gyz', // Jessica Anne Bogart
      name: 'Jessica Anne Bogart',
      description: 'Wickedly eloquent female villain voice',
      settings: {
        stability: 0.8,
        similarity_boost: 0.85,
        style: 0.5,
        use_speaker_boost: true,
      },
    } as VoiceConfig,
  ],

  creatures: [
    {
      id: 'cPoqAvGWCPfCfyPMwe4z', // Kallixis
      name: 'Kallixis',
      description: 'Deep ancient malevolence voice',
      settings: {
        stability: 0.9,
        similarity_boost: 0.7,
        style: 0.1,
        use_speaker_boost: false,
      },
    } as VoiceConfig,
    {
      id: 'dfZGXKiIzjizWtJ0NgPy', // Michael Mouse
      name: 'Michael Mouse',
      description: 'High-pitched comic character for goblins',
      settings: {
        stability: 0.3,
        similarity_boost: 0.6,
        style: 0.6,
        use_speaker_boost: true,
      },
    } as VoiceConfig,
  ],
};
