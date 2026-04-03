import { describe, it, expect } from 'vitest';

import {
  stripOptionMenus,
  stripVisualPromptBlocks,
  stripSeparatorLines,
  stripAssetTags,
  sanitizeForMemoryExtraction,
  splitIntoSegments,
} from '../segmentation';

describe('stripOptionMenus', () => {
  it('removes A/B/C option menu lines', () => {
    const input =
      'The innkeeper gestures broadly.\nA. **Approach cautiously**, sneak up.\nB. **Charge forward**, yelling a battle cry.\nC. **Negotiate**, use your silver tongue.';
    const result = stripOptionMenus(input);
    expect(result).not.toMatch(/^[A-C]\./m);
    expect(result).toContain('The innkeeper gestures broadly.');
  });

  it('removes lowercase a/b/c option lines', () => {
    const input = 'a. sneak\nb. fight\nc. talk';
    const result = stripOptionMenus(input);
    expect(result).not.toMatch(/^[a-c]\./m);
  });

  it('removes parenthetical "(Request a ... check)" helper phrases', () => {
    const input =
      'A. **Sneak past the guards** (Request a Stealth check)\nB. **Intimidate the guard** (Request a Charisma check)';
    const result = stripOptionMenus(input);
    expect(result).not.toContain('(Request a Stealth check)');
    expect(result).not.toContain('(Request a Charisma check)');
  });

  it('preserves narrative text that happens to start with A or B mid-sentence', () => {
    // "A dragon swooped" does not match the "A. " prefix pattern
    const input = 'A dragon swooped low over the village.';
    const result = stripOptionMenus(input);
    expect(result).toContain('A dragon swooped low over the village.');
  });

  it('handles content with no option menus unchanged', () => {
    const input = 'The sword glints in the torchlight.';
    expect(stripOptionMenus(input)).toBe(input);
  });

  it('strips (Request a ... check...) with trailing ellipsis before closing paren', () => {
    const input = 'A. **Glance at the tray** (Request a Perception check...)';
    expect(stripOptionMenus(input)).not.toContain('(Request a Perception check...)');
  });

  it('strips (Request an ... check...) — "an" variant with multi-word check and ellipsis', () => {
    const input = 'B. **Reach for the fork** (Request an Arcana or Religion check...)';
    expect(stripOptionMenus(input)).not.toContain('(Request an Arcana or Religion check...)');
  });

  it('strips parenthetical check request when A/B/C prefix is already absent (selected-option path)', () => {
    // Player-selected action text arrives without the A/B/C prefix but may retain the parenthetical
    const input = 'Glance at the tray. (Request a Perception check...)';
    expect(stripOptionMenus(input)).not.toContain('(Request a Perception check...)');
  });
});

describe('stripVisualPromptBlocks', () => {
  it('removes fenced VISUAL PROMPT blocks', () => {
    const input =
      'Narrative text here.\n```VISUAL PROMPT\nMoonlit forest clearing with standing stones\n```';
    const result = stripVisualPromptBlocks(input);
    expect(result).not.toContain('VISUAL PROMPT');
    expect(result).not.toContain('Moonlit forest clearing');
    expect(result).toContain('Narrative text here.');
  });

  it('removes inline VISUAL PROMPT: markers', () => {
    const input = 'Story continues.\nVISUAL PROMPT: Dark ancient ruins under a blood moon';
    const result = stripVisualPromptBlocks(input);
    expect(result).not.toContain('VISUAL PROMPT');
    expect(result).not.toContain('Dark ancient ruins');
    expect(result).toContain('Story continues.');
  });

  it('removes VISUAL PROMPT with underscores or dashes', () => {
    const input = 'Text.\nVISUAL_PROMPT: A crumbling tower\nMore text.';
    const result = stripVisualPromptBlocks(input);
    expect(result).not.toContain('VISUAL_PROMPT');
    expect(result).not.toContain('A crumbling tower');
  });

  it('handles content with no VISUAL PROMPT unchanged', () => {
    const input = 'The ranger tracks the beast through mud.';
    expect(stripVisualPromptBlocks(input)).toBe(input);
  });
});

describe('stripSeparatorLines', () => {
  it('removes --- separator lines', () => {
    const input = 'Para one.\n---\nPara two.';
    const result = stripSeparatorLines(input);
    expect(result).not.toContain('---');
    expect(result).toContain('Para one.');
    expect(result).toContain('Para two.');
  });

  it('removes **** separator lines', () => {
    const input = 'Para one.\n****\nPara two.';
    const result = stripSeparatorLines(input);
    expect(result).not.toContain('****');
    expect(result).toContain('Para one.');
    expect(result).toContain('Para two.');
  });

  it('removes long separator lines', () => {
    const input = 'Before.\n----------\nAfter.';
    const result = stripSeparatorLines(input);
    expect(result).not.toMatch(/^[-]{3,}$/m);
  });

  it('does not strip dashes that are mid-sentence', () => {
    const input = 'The elf—quick and sharp—dodged the blow.';
    const result = stripSeparatorLines(input);
    expect(result).toContain('The elf—quick and sharp—dodged the blow.');
  });

  it('handles content with no separators unchanged', () => {
    const input = 'The paladin raises her shield.';
    expect(stripSeparatorLines(input)).toBe(input);
  });
});

describe('sanitizeForMemoryExtraction', () => {
  it('strips ROLL_REQUESTS_V1 code blocks (regression)', () => {
    const input =
      'The goblin lunges!\n```ROLL_REQUESTS_V1\n{"rolls":[{"type":"attack","formula":"1d20+4","dc":14}]}\n```\nYou dodge narrowly.';
    const result = sanitizeForMemoryExtraction(input);
    expect(result).not.toContain('ROLL_REQUESTS_V1');
    expect(result).not.toContain('"rolls"');
    expect(result).toContain('The goblin lunges!');
    expect(result).toContain('You dodge narrowly.');
  });

  it('strips all scaffolding from a full realistic AI response', () => {
    const fullResponse = [
      'The ancient door creaks open, revealing a chamber of forgotten lore.',
      '',
      '```ROLL_REQUESTS_V1',
      '{"rolls":[{"type":"skill_check","formula":"1d20+wis","purpose":"Perception","dc":12}]}',
      '```',
      '',
      'A. **Examine the altar**, search for hidden mechanisms.',
      'B. **Pocket the gemstone**, take it for yourself.',
      'C. **Call out** (Request a Persuasion check), announce your presence.',
      '',
      '---',
      '',
      'VISUAL PROMPT: Dusty stone chamber with a glowing altar and scattered scrolls',
      '',
      '<memories>',
      '- The party discovered a hidden chamber beneath the catacombs',
      '</memories>',
    ].join('\n');

    const result = sanitizeForMemoryExtraction(fullResponse);

    // Scaffolding must be gone
    expect(result).not.toContain('ROLL_REQUESTS_V1');
    expect(result).not.toMatch(/^[A-C]\./m);
    expect(result).not.toContain('(Request a Persuasion check)');
    expect(result).not.toMatch(/^---$/m);
    expect(result).not.toContain('VISUAL PROMPT');

    // Narrative must survive
    expect(result).toContain('The ancient door creaks open');

    // XML tags are not stripped by sanitizeForMemoryExtraction (handled by xml-parser)
    // — they may remain; that is acceptable
  });

  it('is idempotent — applying twice gives the same result', () => {
    const input = 'A. **Fight!**\n---\nVISUAL PROMPT: Battlefield at dusk\nNarrative line.';
    const once = sanitizeForMemoryExtraction(input);
    const twice = sanitizeForMemoryExtraction(once);
    expect(once).toBe(twice);
  });
});

describe('stripAssetTags', () => {
  it('strips a well-formed asset tag', () => {
    const result = stripAssetTags('You see [ASSET:npc:lord-diabolo] standing in the doorway.');
    expect(result).not.toContain('[ASSET:');
    expect(result).toContain('You see Lord Diabolo standing in the doorway.');
  });

  it('strips multiple asset tags in one string', () => {
    const input = '[ASSET:character:the-veteran] and [ASSET:location:bone-cathedral] appear.';
    const result = stripAssetTags(input);
    expect(result).not.toContain('[ASSET:');
    expect(result).toContain('and');
    expect(result).toContain('appear.');
  });

  it('collapses double spaces left after removal', () => {
    const result = stripAssetTags('Enter [ASSET:npc:remy] now.');
    expect(result).not.toMatch(/ {2}/);
  });

  it('passes through content with no asset tags unchanged', () => {
    const plain = 'The dragon swoops low.';
    expect(stripAssetTags(plain)).toBe(plain);
  });
});

describe('sanitizeForMemoryExtraction — asset tag stripping (issue #341)', () => {
  it('strips [ASSET:*] tags from memory extraction input', () => {
    const input =
      'Lord Diabolo [ASSET:npc:lord-diabolo] steps forward. The cathedral [ASSET:location:bone-cathedral] looms.';
    const result = sanitizeForMemoryExtraction(input);
    expect(result).not.toContain('[ASSET:');
    expect(result).toContain('Lord Diabolo');
    expect(result).toContain('steps forward.');
  });

  it('short content that produces empty segments yields sanitized fallback (no ASSET tags)', () => {
    // Content shorter than minLength=20 will fall through to the fallback path in classification.ts.
    // The fallback must sanitize, which includes stripping asset tags.
    const input = '[ASSET:npc:foo] Hi.';
    const result = sanitizeForMemoryExtraction(input);
    expect(result).not.toContain('[ASSET:');
  });

  it('cleans markdown and quote artifacts left around stripped asset tags', () => {
    const input = [
      'A gelatinous mass—[ASSET:npc:dishwasher-prime] **Dishwasher Prime**—bounces into view.',
      '“Oopsie! ” it giggles.',
      '*“The first shift starts in ten minutes. ”*',
    ].join(' ');

    const result = sanitizeForMemoryExtraction(input);

    expect(result).toContain('A gelatinous mass—Dishwasher Prime—bounces into view.');
    expect(result).toContain('“Oopsie!” it giggles.');
    expect(result).toContain('“The first shift starts in ten minutes.”');
    expect(result).not.toContain('*');
    expect(result).not.toContain('[ASSET:');
  });
});

describe('splitIntoSegments — scaffolding never becomes a segment', () => {
  it('produces no segment that starts with an option prefix', () => {
    const input = [
      'The wizard raises his staff dramatically.',
      'A. **Attack the golem**, charge with your weapon.',
      'B. **Flee the room**, run for the exit.',
      'C. **Reason with it** (Request an Arcana check), attempt to communicate.',
    ].join('\n');

    const segments = splitIntoSegments(input);
    for (const seg of segments) {
      expect(seg).not.toMatch(/^[A-Ca-c]\.\s/);
    }
  });

  it('produces no segment containing VISUAL PROMPT text', () => {
    const input = [
      'The fortress looms against a stormy sky.',
      'VISUAL PROMPT: Imposing stone fortress with lightning-lit battlements',
    ].join('\n');

    const segments = splitIntoSegments(input);
    for (const seg of segments) {
      expect(seg).not.toContain('VISUAL PROMPT');
    }
  });

  it('produces no segment containing a bare separator', () => {
    const input = 'The thief slips through the shadows.\n---\nA chest glints in the corner.';
    const segments = splitIntoSegments(input);
    for (const seg of segments) {
      expect(seg.trim()).not.toBe('---');
    }
  });
});
