/** Stable campaign casting IDs shared by the server and both playback providers. */
export const IR_VOICES = {
  narrator: { kokoro: 'bm_fable', premium: 'T0GKiSwCb51L7pv1sshd', traits: ['narrator'] },
  thomas: {
    kokoro: 'am_michael',
    premium: 'GBv7mTt0atIp3Br8iCZE',
    traits: ['male', 'hero', 'guard', 'gruff'],
  },
  fena: {
    kokoro: 'af_bella',
    premium: 'BlgEcC0TfWpBak7FmvHW',
    traits: ['female', 'hero', 'young'],
  },
  oxley: {
    kokoro: 'bm_george',
    premium: '2gPFXx8pN3Avh27Dw5Ma',
    traits: ['male', 'villain', 'ominous'],
  },
  jessica: {
    kokoro: 'bf_emma',
    premium: 'flHkNRp1BlvT73UL6gyz',
    traits: ['female', 'villain', 'eloquent'],
  },
  kallixis: {
    kokoro: 'am_fenrir',
    premium: 'cPoqAvGWCPfCfyPMwe4z',
    traits: ['monster', 'deep', 'ancient'],
  },
  mouse: {
    kokoro: 'am_puck',
    premium: 'dfZGXKiIzjizWtJ0NgPy',
    traits: ['goblin', 'comic', 'high'],
  },
  nathan: {
    kokoro: 'am_echo',
    premium: 'g2W4HAjKvdW93AmsjsOx',
    traits: ['merchant', 'male', 'friendly'],
  },
  serena: {
    kokoro: 'af_heart',
    premium: 'pMsXgVXv3BLzUgSXRplE',
    traits: ['innkeeper', 'female', 'warm'],
  },
  billy: { kokoro: 'af_sky', premium: 'ha06sua2KFh5KIb2atMC', traits: ['child', 'light', 'cute'] },
  sam: { kokoro: 'bm_daniel', premium: 'yoZ06aMxZJJ28mfd3POQ', traits: ['elder', 'wise', 'male'] },
} as const;
export type IrVoiceId = keyof typeof IR_VOICES;
export function irVoice(value: string) {
  return Object.prototype.hasOwnProperty.call(IR_VOICES, value)
    ? IR_VOICES[value as IrVoiceId]
    : undefined;
}
/** Legacy provider IDs remain readable without overwriting a saved NPC or session row. */
export function canonicalIrVoice(value: string): IrVoiceId | undefined {
  if (irVoice(value)) return value as IrVoiceId;
  return (Object.keys(IR_VOICES) as IrVoiceId[]).find((id) => IR_VOICES[id].premium === value);
}
export interface CastingSegment {
  type: string;
  text: string;
  character?: string | null;
  voice_category?: string | null;
  npc_id?: string | null;
}
export interface CastSegment extends CastingSegment {
  npc_id: string | null;
  voice_id: string | null;
  voice_muted: boolean;
}
export function normalizeSpeaker(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function hash(value: string): number {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
export function pickNpcVoice(
  campaignId: string,
  npcId: string,
  traits: string,
  used: Set<string>,
): IrVoiceId | undefined {
  const words = new Set(traits.toLowerCase().split(/[^a-z]+/));
  return (Object.keys(IR_VOICES) as IrVoiceId[])
    .filter((id) => id !== 'narrator' && !used.has(id))
    .sort((a, b) => {
      const score = (id: IrVoiceId) =>
        IR_VOICES[id].traits.filter((trait) => words.has(trait)).length;
      return (
        score(b) - score(a) ||
        hash(`${campaignId}:${npcId}:${a}`) - hash(`${campaignId}:${npcId}:${b}`) ||
        a.localeCompare(b)
      );
    })[0];
}
