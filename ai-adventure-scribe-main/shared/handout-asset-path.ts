/**
 * Storage key for a handout image in the `campaign-images` bucket.
 *
 * Single owner of the rule. The server writes it into the journal row's
 * `asset_path`, the client reads that exact string, and the campaign asset
 * uploader writes the object under the same key.
 */
export const handoutAssetPath = (campaignId: string, key: string): string =>
  `campaigns/${campaignId}/handouts/${key}.png`;
