import { stripEngineGeneratedLines } from '@/utils/engine-lines';

/**
 * The short scene description under the campaign title, taken from a DM reply. Engine transcript
 * lines ("⚙️ Engine: …") are stripped first: they are rules output, not scene text (#2256).
 * Returns '' when nothing is left; callers then keep the previous description.
 */
export const toHeaderExcerpt = (raw: string, limit = 220): string => {
  if (!raw) return '';
  const cleaned = stripEngineGeneratedLines(raw)
    .replace(/^VISUAL\s+PROMPT:.*$/gim, '')
    .replace(/^\s*[A-F]\.\s.*$/gim, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  let out = sentences.slice(0, 2).join(' ');
  if (out.length > limit) {
    out = out.slice(0, limit).replace(/[ ,;:]+\S*$/, '') + '…';
  }
  return out;
};
