import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageRenderer } from '../MessageRenderer';

import type { ChatMessage } from '@/types/game';

import {
  buildSpellCastContext,
  buildSpellCastMessage,
} from '@/features/game-session/components/game/overhaul/spell-view-model';

/**
 * #2343 A2: the sheet's Cast stores `I cast Chill Touch [spell_id=chill-touch, spell_level=cantrip].`
 * so the engine can read the spell. The player's bubble showed that markup. The message below is
 * built by the producers the sheet uses (`buildSpellCastMessage`, `buildSpellCastContext`).
 */
const sheetCast = (spell: { id: string; name: string; level: number | null }): ChatMessage => ({
  text: buildSpellCastMessage(spell),
  sender: 'player',
  context: buildSpellCastContext(spell),
});

const renderBubble = (message: ChatMessage) =>
  render(
    <MessageRenderer
      message={message}
      messageId="m-cast"
      groupIndex={0}
      msgIndex={0}
      isFirstInGroup
      isLastInGroup
      isPlayer
      isDM={false}
      isCompanion={false}
      expandedMessages={new Set()}
      setExpandedMessages={vi.fn() as never}
      imageByMessage={{}}
      generatingFor={new Set()}
      genErrorByMessage={{}}
      onGenerateScene={vi.fn().mockResolvedValue(undefined)}
      onOptionSelect={vi.fn().mockResolvedValue(undefined)}
    />,
  );

describe('the player bubble for a sheet Cast (#2343 A2)', () => {
  it.each([
    [{ id: 'chill-touch', name: 'Chill Touch', level: 0 }, 'I cast Chill Touch.'],
    [{ id: 'magic-missile', name: 'Magic Missile', level: 1 }, 'I cast Magic Missile.'],
  ])('shows the words, not the tag, for %j', (spell, shown) => {
    const message = sheetCast(spell);
    const { container } = renderBubble(message);

    expect(screen.getByText(shown)).toBeInTheDocument();
    expect(container.textContent).not.toContain('spell_id');
    expect(container.textContent).not.toContain('spell_level');
    // The payload is untouched: the tag is what the engine reads.
    expect(message.text).toContain(`[spell_id=${spell.id}, spell_level=`);
    expect(message.context).toMatchObject({ intent: 'spell_cast', spellId: spell.id });
  });

  it('leaves an ordinary typed message alone', () => {
    renderBubble({ text: 'I cast Chill Touch at the imp.', sender: 'player' });

    expect(screen.getByText('I cast Chill Touch at the imp.')).toBeInTheDocument();
  });
});
