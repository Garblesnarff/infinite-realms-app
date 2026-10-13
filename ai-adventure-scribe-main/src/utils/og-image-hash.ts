import { createHash } from 'node:crypto';

/**
 * Computes a sha256 content hash of image bytes, truncated to 8 hex characters.
 */
export function computeOgImageHash(buffer: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 8);
}

/**
 * Returns the content-hashed og-image filename.
 */
export function getOgImageHashedFilename(hash: string): string {
  return `og-image.${hash}.png`;
}

/**
 * Replaces `/og-image.png` references in HTML strings with `/<hashed-filename>`.
 */
export function transformOgImageInHtml(html: string, hashedFilename: string): string {
  return html.split('/og-image.png').join(`/${hashedFilename}`);
}
