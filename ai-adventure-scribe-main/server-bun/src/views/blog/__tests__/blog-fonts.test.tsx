/**
 * #1492: the server-rendered blog loads the same one font set as the SPA (#1432): no Inter, no
 * second Cinzel set; DM Sans for UI, Cinzel and EB Garamond for display and prose.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';
import { renderToString } from 'react-dom/server';

import { getSiteConfig } from '../../../config/site.js';
import { APP_FONTS_HREF } from '../../app-fonts.js';
import { BlogIndexPage } from '../index.js';

const escaped = APP_FONTS_HREF.replaceAll('&', '&amp;');

describe('blog fonts (#1492)', () => {
  it('loads the one app font set and nothing else from Google Fonts', () => {
    const html = renderToString(<BlogIndexPage site={getSiteConfig()} assets={null} posts={[]} />);
    expect(html).toContain(`href="${escaped}"`);
    expect(html.match(/fonts\.googleapis\.com\/css2/g)).toHaveLength(1);
    expect(html).not.toContain('family=Inter');
    for (const family of ['Cinzel', 'EB+Garamond', 'DM+Sans']) {
      expect(APP_FONTS_HREF).toContain(`family=${family}`);
    }
    expect(APP_FONTS_HREF).toContain('display=swap');
  });

  it('uses the same link as the SPA index.html', () => {
    const indexHtml = readFileSync(
      fileURLToPath(new URL('../../../../../index.html', import.meta.url)),
      'utf8',
    );
    expect(indexHtml).toContain(`href="${APP_FONTS_HREF}"`);
  });
});
