import React from 'react';

import { CampaignEndState } from './CampaignEndState';
import { formatNarrative } from '../../chat/message-list/formatNarrative';
import { prepareChatDisplayText } from '../../chat/message-list/prepare-chat-display-text';

import { chronicleRefetchInterval } from '@/components/chronicles/ChronicleViewer';
import { Button } from '@/components/ui/button';
import { useMessageContext, useOptionalMessageContext } from '@/contexts/MessageContext';
import { trpc } from '@/infrastructure/api';
import { combatEngineBlocksFromContext } from '@/utils/combat-engine-blocks';

export { displayFinalLine } from './CampaignEndState';

/**
 * The route back into a campaign with a new hero. A starter campaign goes
 * through its hero pick; a custom campaign goes through character creation
 * carrying the campaign. Never the bare `/app/characters/create`: after the
 * wizard that lands on the character list, not in the game, and carries no
 * campaign (#2520 §5).
 */
export function buildChooseHeroHref(input: {
  starterSlug?: string | null;
  campaignId?: string | null;
}): string {
  if (input.starterSlug && input.campaignId) {
    return `/explore/${encodeURIComponent(input.starterSlug)}?campaignId=${encodeURIComponent(input.campaignId)}#heroes`;
  }
  if (input.campaignId) {
    return `/app/characters/create?campaign=${encodeURIComponent(input.campaignId)}`;
  }
  return '/explore';
}

/**
 * #2517: the engine's final lines of the run's last round, read back from the
 * saved log. A live death carries them from the terminal state; a reload does
 * not, so the screen reads them here with the same blocks the Log tab shows.
 * Newest round only, at most `limit` lines, newest last.
 */
export function finalEngineLines(
  messages: ReadonlyArray<{ sender?: string; context?: Record<string, unknown> }>,
  limit = 3,
): string[] {
  const blocks: { round: number; lines: string[] }[] = [];
  for (const message of messages) {
    if (message.sender !== 'system') continue;
    for (const block of combatEngineBlocksFromContext(message.context)) {
      blocks.push({ round: block.round, lines: block.lines });
    }
  }
  const last = blocks[blocks.length - 1];
  if (!last) return [];
  const lines: string[] = [];
  for (
    let index = blocks.length - 1;
    index >= 0 && blocks[index].round === last.round;
    index -= 1
  ) {
    lines.unshift(...blocks[index].lines);
  }
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-limit);
}

/**
 * The engine prefixes its transcript lines (`⚙️ Engine: …`). The player
 * already saw those lines rendered from the formatter; on this screen the
 * raw prefix must not leak through.
 */
interface FallenEndStateProps {
  /** Name of the fallen player character, when known. */
  characterName?: string | null;
  /** Trusted character presentation data from the owning game route. */
  portraitUrl?: string | null;
  identity?: string | null;
  /**
   * #2517: the engine's final lines (killing blow, failed death saves). The
   * killing round gets no DM narration; the screen carries these instead.
   * Absent on a restored load — the lines are in the story behind the
   * "Read the story so far" view.
   */
  finalLines?: string[];
  /** Campaign display name for the hero-pick helper line. */
  campaignName?: string | null;
  /**
   * Route back into this campaign with a new hero (buildChooseHeroHref);
   * null hides the offer when there is no campaign to return to (#1215).
   */
  chooseHeroHref: string | null;
  /**
   * #2517: the hero-pick route is not final yet (the starter-campaign list
   * that resolves the slug is still loading). A wrong-route click in that
   * window strands the player on the custom-campaign form, so the button
   * waits for the resolved route instead of racing it.
   */
  chooseHeroPending?: boolean;
  /**
   * The read-only story (session log). When provided, "Read the story so
   * far" swaps to it INSIDE this end state — there is no dismiss back to a
   * live game (#2520 §4).
   */
  storyContent?: React.ReactNode;
  /** #1239: see CampaignEndState. Omitted means the hero is not a premade. */
  characterId?: string | null;
  premade?: boolean;
  premadeKept?: boolean;
  /** Fade the screen in (a live death). A reload stays still. */
  fadeIn?: boolean;
}

/**
 * #2517/#2520: the fallen character's end state, rendered as a page state —
 * it replaces the game screen rather than overlaying it, so no composer,
 * sheet or tracker exists underneath. The single truth for showing it is
 * `character_stats.vital_state === 'dead'`, read in the session load
 * payload; `party_defeated` and PartyDefeatedError are live triggers only.
 */
export const FallenEndState: React.FC<FallenEndStateProps> = ({
  characterName,
  portraitUrl,
  identity,
  finalLines,
  campaignName,
  chooseHeroHref,
  chooseHeroPending,
  storyContent,
  characterId,
  premade,
  premadeKept,
  fadeIn,
}) => {
  const messageContext = useOptionalMessageContext();
  const messages = messageContext?.messages;
  const restoredLines = React.useMemo(
    () => (messages ? finalEngineLines(messages) : []),
    [messages],
  );
  return (
    <CampaignEndState
      mode="fallen"
      characterName={characterName}
      portraitUrl={portraitUrl}
      identity={identity}
      finalLines={finalLines?.length ? finalLines : restoredLines}
      campaignName={campaignName}
      chooseHeroHref={chooseHeroHref}
      chooseHeroPending={chooseHeroPending}
      storyContent={storyContent}
      characterId={characterId}
      premade={premade}
      premadeKept={premadeKept}
      fadeIn={fadeIn}
    />
  );
};

/**
 * The chronicle tab of the story view. Reads the session's chronicle and writes one on request;
 * the write is the same `chronicles.generate` the chronicle dialog uses.
 */
const FallenChronicle: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const utils = trpc.useUtils();
  const { data: chronicle, isLoading } = trpc.chronicles.getBySessionId.useQuery(
    { sessionId },
    { refetchInterval: chronicleRefetchInterval },
  );
  const generate = trpc.chronicles.generate.useMutation({
    onSuccess: () => utils.chronicles.getBySessionId.invalidate({ sessionId }),
  });
  const write = (): void => {
    generate.mutate({ sessionId });
  };
  const status = chronicle?.status ?? null;
  if (isLoading) {
    return <p className="py-5 text-sm text-muted-foreground">Loading the chronicle…</p>;
  }
  if (generate.isPending || status === 'generating') {
    return (
      <div role="status" className="space-y-3 py-5">
        <p className="text-base text-white/85">Writing the chronicle…</p>
        <div aria-hidden="true" className="ir-end-pulse h-1.5 w-full rounded-full bg-white/10" />
      </div>
    );
  }
  if (generate.isError || status === 'failed') {
    return (
      <div role="alert" className="space-y-2 py-5">
        <p className="text-base font-semibold text-white/90">The chronicle could not be written.</p>
        <p className="text-sm text-white/65">Your story is safe. Try again in a moment.</p>
        <Button type="button" variant="outline" className="min-h-11" onClick={write}>
          Try again
        </Button>
      </div>
    );
  }
  if (status === 'ready') {
    return (
      <article className="space-y-3 py-5">
        <p className="ir-display text-xs font-semibold uppercase tracking-[1.5px] text-infinite-gold">
          Chronicle
        </p>
        {chronicle?.chapterTitle && (
          <h2 className="ir-display text-2xl text-infinite-gold-light">{chronicle.chapterTitle}</h2>
        )}
        {chronicle?.chronicleText && (
          <p className="ir-narr whitespace-pre-wrap text-base leading-relaxed text-white/90">
            {chronicle.chronicleText}
          </p>
        )}
      </article>
    );
  }
  return (
    <div className="space-y-3 py-5">
      <p className="ir-display text-lg text-infinite-gold-light">No chronicle yet</p>
      <p className="text-base leading-relaxed text-white/75">
        A chronicle turns the log into a short tale. It takes about half a minute.
      </p>
      <Button type="button" className="ir-gold-button min-h-11" onClick={write}>
        Write the chronicle
      </Button>
    </div>
  );
};

/**
 * The saved session log, read-only: no composer, no roll tray, no sheet.
 * Renders the messages the MessageProvider already loaded for the session.
 * With a `sessionId` the view also carries a Chronicle tab (#2520 §4).
 */
export const FallenStoryLog: React.FC<{ sessionId?: string | null }> = ({ sessionId }) => {
  const [tab, setTab] = React.useState<'log' | 'chronicle'>('log');
  const log = <FallenStoryEntries />;
  if (!sessionId) return log;
  const tabClass = (selected: boolean): string =>
    `min-h-11 border-b-2 px-3 text-sm font-semibold ${
      selected
        ? 'border-infinite-gold text-infinite-gold-light'
        : 'border-transparent text-white/65 hover:text-infinite-gold-light'
    }`;
  return (
    <div className="space-y-2">
      <div role="tablist" aria-label="Story" className="flex gap-1 border-b border-white/10">
        <button
          type="button"
          role="tab"
          id="story-tab-log"
          aria-selected={tab === 'log'}
          aria-controls="story-tabpanel"
          className={tabClass(tab === 'log')}
          onClick={() => setTab('log')}
        >
          Log
        </button>
        <button
          type="button"
          role="tab"
          id="story-tab-chronicle"
          aria-selected={tab === 'chronicle'}
          aria-controls="story-tabpanel"
          className={tabClass(tab === 'chronicle')}
          onClick={() => setTab('chronicle')}
        >
          Chronicle
        </button>
      </div>
      <div role="tabpanel" id="story-tabpanel" aria-labelledby={`story-tab-${tab}`}>
        {tab === 'log' ? log : <FallenChronicle sessionId={sessionId} />}
      </div>
    </div>
  );
};

const FallenStoryEntries: React.FC = () => {
  const { messages, historyReady, hasMore, loadMore, isLoading, isFetchingMore, messagesError } =
    useMessageContext();
  const requestedAtCount = React.useRef(-1);
  React.useEffect(() => {
    if (
      historyReady &&
      hasMore &&
      !isLoading &&
      !isFetchingMore &&
      !messagesError &&
      messages.length > requestedAtCount.current
    ) {
      requestedAtCount.current = messages.length;
      loadMore();
    }
  }, [historyReady, hasMore, isLoading, isFetchingMore, messagesError, loadMore, messages.length]);
  // The chat display preparation removes engine lines and roll requests from DM prose.
  const visible = messages
    .map((message) => {
      let text = '';
      if (message.sender === 'dm') {
        text = prepareChatDisplayText(message.text ?? '').text;
      } else if (
        message.sender === 'player' &&
        message.context?.intent !== 'dice_roll' &&
        !message.context?.diceRoll
      ) {
        text = message.text ?? '';
      } else if (message.sender === 'system') {
        const blocks = combatEngineBlocksFromContext(message.context);
        const cards = blocks.length
          ? blocks.flatMap((block) => block.cards ?? [])
          : (message.context?.engineCards ?? []);
        text = cards
          .flatMap((card) => {
            if (card.kind === 'initiative' || card.kind === 'refused') return [];
            if (card.kind === 'death_save') {
              if (card.math?.kind !== 'attack') return card.detail ? [card.detail] : [];
              const status =
                card.status && card.hp
                  ? `${card.hp.name} is ${card.status.toLowerCase()}`
                  : card.status;
              return [[card.detail, card.effect, status].filter(Boolean).join(' ')];
            }
            const outcome = card.badge ? `: ${card.badge.word.toLowerCase()}` : '';
            const status =
              card.status && card.hp
                ? `${card.hp.name} is ${card.status.toLowerCase()}`
                : card.status;
            return [[`${card.title}${outcome}.`, card.effect, status].filter(Boolean).join(' ')];
          })
          .join('\n\n');
      }
      return { message, text };
    })
    .filter(({ text }) => text.trim());
  if (visible.length === 0 && !hasMore) {
    return (
      <p className="text-sm text-muted-foreground">The story so far is still being written.</p>
    );
  }
  return (
    <div data-testid="death-screen-story-log" className="space-y-3">
      {hasMore && (
        <button type="button" onClick={loadMore} disabled={isLoading || isFetchingMore}>
          {isLoading || isFetchingMore
            ? 'Loading earlier story…'
            : messagesError
              ? 'Retry loading earlier story'
              : 'Load earlier story'}
        </button>
      )}
      {visible.map(({ message, text }, index) => (
        <div key={message.id ?? index}>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-card-foreground">
            {formatNarrative(text).content}
          </div>
        </div>
      ))}
    </div>
  );
};
