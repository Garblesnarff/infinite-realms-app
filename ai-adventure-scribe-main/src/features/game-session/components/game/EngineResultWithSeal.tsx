import React from 'react';

import { EngineResultCardView } from './EngineResultCardView';

import type { EngineResultCard } from '@/services/combat/engine-result-card';

import { ResultWaxSeal } from '@/components/game/ResultWaxSeal';
import { useTableLookActive } from '@/features/campaigns/table/useTableLookActive';

function sealWordForCard(card: EngineResultCard): string | undefined {
  if (card.badge?.word) return card.badge.word;
  if (card.kind !== 'initiative') return undefined;
  const player = card.initiative?.order.find((entry) => entry.isPlayer);
  const total = player?.initiative ?? card.initiative?.order[0]?.initiative;
  return total === undefined ? undefined : String(total);
}

/**
 * The result card the live session already mounts, plus the Check-board seal.
 * The badge stays in the layout and is hidden while Table look is on, so the
 * seal sits where that badge sat. The word is the card's own badge, or the
 * initiative total the seating card stored.
 */
export const EngineResultWithSeal: React.FC<{
  card: EngineResultCard;
  showTargetNumbers: boolean;
}> = ({ card, showTargetNumbers }) => {
  const tableLook = useTableLookActive();
  // A narrative check card is #1477. This PR seals saves, attacks, NPC rolls and initiative.
  const word = card.kind === 'check' ? undefined : sealWordForCard(card);
  return (
    <div
      className={
        tableLook && word ? 'relative [&_[data-testid=engine-card-badge]]:invisible' : undefined
      }
    >
      <EngineResultCardView card={card} showTargetNumbers={showTargetNumbers} />
      {tableLook && word ? (
        <div aria-hidden="true" className="pointer-events-none absolute right-4 top-3">
          <ResultWaxSeal word={word} engineTone={card.badge?.tone} />
        </div>
      ) : null}
    </div>
  );
};
