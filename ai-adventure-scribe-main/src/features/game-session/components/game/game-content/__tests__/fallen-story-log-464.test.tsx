import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [
      {
        id: 'm1',
        sender: 'dm',
        text: 'You reach [ASSET:location:base-camp-alpha] Base Camp Alpha. [ASSET:npc:professor-vale] Professor Vale waits.\nA. **Scout ahead**\nB. **Question the Professor**',
      },
    ],
  }),
}));

import { FallenStoryLog } from '../DeathScreen';

describe('FallenStoryLog (#464)', () => {
  it('drops [ASSET:] tags and renders **bold** as bold, with no literal markup', () => {
    render(<FallenStoryLog />);
    const log = screen.getByTestId('death-screen-story-log');
    expect(log.textContent).not.toContain('[ASSET:');
    expect(log.textContent).not.toContain('**');
    expect(log.textContent).toContain('Base Camp Alpha');
    expect(screen.getByText('Scout ahead').tagName).toBe('STRONG');
    expect(screen.getByText('Question the Professor').tagName).toBe('STRONG');
  });
});
