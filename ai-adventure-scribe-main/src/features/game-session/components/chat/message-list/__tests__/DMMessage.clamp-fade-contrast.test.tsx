import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';

vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn(), assets: [] }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));

const longText = 'A'.repeat(820) + ' [HP 28/28] [Class';

const renderDm = (props: Partial<React.ComponentProps<typeof DMMessage>> = {}) =>
  render(
    <DMMessage
      message={{ sender: 'dm', text: longText }}
      messageId="dm-1"
      isFirstInGroup
      isLastInGroup
      displayContent={longText}
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
      {...props}
    />,
  );

const readCss = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('DMMessage clamp-fade contrast (#1562)', () => {
  it('clamps a long narrative and keeps parchment/dm-bubble on the article', () => {
    const { container } = renderDm();

    const narrative = container.querySelector('.dm-narrative');
    expect(narrative).not.toBeNull();
    expect(narrative?.className).toContain('clamp-fade');

    const article = screen.getByLabelText('Dungeon Master message');
    expect(article.className).toContain('ir-parchment');
    expect(article.className).toContain('dm-bubble');
  });

  it('Table look overrides the clamp-fade fade end to parchment, not dark navy', () => {
    const indexCss = readCss('../../../../../../index.css');
    const tableCss = readCss('../../../../../../styles/ir-table.css');

    // Extract only the real .clamp-fade::after rule from index.css (jsdom cannot
    // parse the whole stylesheet), so CSSOM reflects the actual source rule.
    const afterIdx = indexCss.indexOf('.clamp-fade::after');
    expect(afterIdx).toBeGreaterThanOrEqual(0);
    const braceStart = indexCss.indexOf('{', afterIdx);
    let depth = 0;
    let i = braceStart;
    while (i < indexCss.length) {
      if (indexCss[i] === '{') depth++;
      else if (indexCss[i] === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    const clampSnippet = `.clamp-fade { position: relative; }\n${indexCss.slice(afterIdx, i)}`;

    const style = document.createElement('style');
    style.textContent = `${clampSnippet}\n${tableCss}`;
    document.head.appendChild(style);
    document.body.classList.add('ir-table-look');

    try {
      const { container } = renderDm();

      const narrative = container.querySelector('.dm-narrative') as HTMLElement | null;
      expect(narrative).not.toBeNull();
      expect(narrative?.className).toContain('clamp-fade');

      const article = screen.getByLabelText('Dungeon Master message');
      expect(article.className).toContain('ir-parchment');
      expect(article.className).toContain('dm-bubble');

      const sheet = style.sheet as CSSStyleSheet;
      const rules = Array.from(sheet.cssRules).filter(
        (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
      );

      const override = rules.find(
        (rule) => rule.selectorText === 'body.ir-table-look .dm-bubble .clamp-fade::after',
      );
      expect(override, 'Table override rule must exist').toBeDefined();
      const overrideBg = override?.style.background || override?.cssText || '';
      expect(overrideBg).toContain('var(--ir-parchment-2)');
      expect(overrideBg).not.toContain('rgba(11, 23, 41');

      const defaultRule = rules.find((rule) => rule.selectorText === '.clamp-fade::after');
      expect(defaultRule, 'default clamp-fade rule must exist').toBeDefined();
      const defaultBg = defaultRule?.style.background || defaultRule?.cssText || '';
      expect(defaultBg).toContain('rgba(11, 23, 41');
    } finally {
      document.body.classList.remove('ir-table-look');
      style.remove();
    }
  });
});
