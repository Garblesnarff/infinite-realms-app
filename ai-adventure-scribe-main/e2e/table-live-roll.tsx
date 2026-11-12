import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ABILITY_CHECK_SAVE_BODY } from '../shared/test-fixtures/ability-check-saves';
import { MessageRenderer } from '../src/features/game-session/components/chat/message-list/MessageRenderer';
import { useMessageQueue } from '../src/hooks/use-message-queue';
import { markAuthReady } from '../src/lib/auth-gate';

import type { ChatMessage } from '../src/types/game';
import '../src/index.css';

/**
 * #1477: a live roll. The real `useMessageQueue` saves the check through the real save path; the
 * e2e test answers the network with the server's response shape. No reload: the saved row is
 * rendered straight from the save response.
 */
function LiveRoll(): React.JSX.Element {
  const { messageMutation } = useMessageQueue('live-session');
  const [rows, setRows] = useState<ChatMessage[]>([]);

  const roll = async (): Promise<void> => {
    const saved = await messageMutation.mutateAsync({
      id: ABILITY_CHECK_SAVE_BODY.id,
      sender: 'player',
      text: ABILITY_CHECK_SAVE_BODY.message,
      context: ABILITY_CHECK_SAVE_BODY.context,
    } as unknown as ChatMessage);
    setRows((previous) => [...previous, saved]);
  };

  return (
    <section aria-label="Live roll">
      <button type="button" onClick={() => void roll()}>
        Roll Athletics
      </button>
      {rows.map((row, index) => (
        <MessageRenderer
          key={`${row.id ?? index}`}
          message={row}
          messageId={`live-${index}`}
          groupIndex={0}
          msgIndex={index}
          isFirstInGroup
          isLastInGroup
          isPlayer={false}
          isDM={false}
          isCompanion={false}
          expandedMessages={new Set()}
          setExpandedMessages={() => undefined}
          imageByMessage={{}}
          generatingFor={new Set()}
          genErrorByMessage={{}}
          onGenerateScene={async () => undefined}
          onOptionSelect={async () => undefined}
        />
      ))}
    </section>
  );
}

function Harness(): React.JSX.Element {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <LiveRoll />
    </QueryClientProvider>
  );
}

// No AuthContext in this harness: open the auth gate so the save call is not held (src/lib/auth-gate.ts).
markAuthReady();
document.body.classList.add('ir-table-look');
createRoot(document.getElementById('root')!).render(
  <main className="ir-app ir-table-walnut min-h-screen p-8 text-foreground">
    <Harness />
  </main>,
);
