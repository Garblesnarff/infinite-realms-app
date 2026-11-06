import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChatInput } from '../ChatInput';
import { ComposerDraftProvider, useStageComposerDraft } from '../composer-draft';

function Stage(): React.JSX.Element {
  const stage = useStageComposerDraft();
  return <button onClick={() => stage?.('I wait instead.')}>Choose idea</button>;
}
describe('composer idea', () => {
  it('sends text using the ordinary message handler', () => {
    const send = vi.fn(async () => {});
    render(
      <ComposerDraftProvider>
        <Stage />
        <ChatInput onSendMessage={send} isDisabled={false} />
      </ComposerDraftProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose idea' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(send).toHaveBeenCalledWith('I wait instead.');
  });
});
