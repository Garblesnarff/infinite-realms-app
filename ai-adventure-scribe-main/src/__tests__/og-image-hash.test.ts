import { describe, expect, it } from 'vitest';

import {
  computeOgImageHash,
  getOgImageHashedFilename,
  transformOgImageInHtml,
} from '../utils/og-image-hash';

describe('og-image content hashing and HTML transformation', () => {
  it('computes deterministic 8-char hex hash from image bytes', () => {
    const buffer1 = Buffer.from('test-image-bytes-v1');
    const buffer2 = Buffer.from('test-image-bytes-v1');

    const hash1 = computeOgImageHash(buffer1);
    const hash2 = computeOgImageHash(buffer2);

    expect(hash1).toHaveLength(8);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{8}$/);
  });

  it('produces a different hash when image bytes change', () => {
    const buffer1 = Buffer.from('test-image-bytes-v1');
    const buffer2 = Buffer.from('test-image-bytes-v2');

    const hash1 = computeOgImageHash(buffer1);
    const hash2 = computeOgImageHash(buffer2);

    expect(hash1).not.toBe(hash2);
  });

  it('generates the expected content-hashed filename', () => {
    const filename = getOgImageHashedFilename('a1b2c3d4');
    expect(filename).toBe('og-image.a1b2c3d4.png');
  });

  it('replaces og-image.png in HTML while preserving OpenGraph/Twitter semantics', () => {
    const inputHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:image" content="https://infiniterealms.app/og-image.png" />
          <meta name="twitter:image" content="https://infiniterealms.app/og-image.png" />
        </head>
      </html>
    `;

    const transformed = transformOgImageInHtml(inputHtml, 'og-image.a1b2c3d4.png');

    expect(transformed).toContain(
      '<meta property="og:image" content="https://infiniterealms.app/og-image.a1b2c3d4.png" />',
    );
    expect(transformed).toContain(
      '<meta name="twitter:image" content="https://infiniterealms.app/og-image.a1b2c3d4.png" />',
    );
    expect(transformed).not.toContain('/og-image.png');
  });
});
