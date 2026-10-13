import { parseAssetTags, type AssetTag } from '../../../utils/parse-asset-tags';

import { extractEngineGeneratedLines } from '@/utils/engine-lines';
import { removeRollRequestsFromMessage } from '@/utils/rollRequestParser';

export interface PreparedChatDisplayText {
  /** Player-facing prose: roll requests, visual prompts and asset tags removed. */
  text: string;
  /** Engine transcript lines extracted from the prose, for a separate chip. */
  engineLines: string[];
  /** Assets referenced by `[ASSET:type:key]` tags in the prose. */
  assetTags: AssetTag[];
}

export function prepareChatDisplayText(displayContent: string): PreparedChatDisplayText {
  let text = removeRollRequestsFromMessage(displayContent);
  text = text.replace(/^[\t ]*VISUAL\s+PROMPT:.*$/gim, '').trim();
  const { lines: engineLines, fiction } = extractEngineGeneratedLines(text);
  text = fiction;
  const { cleanContent, assets: assetTags } = parseAssetTags(text);
  return { text: cleanContent, engineLines, assetTags };
}
