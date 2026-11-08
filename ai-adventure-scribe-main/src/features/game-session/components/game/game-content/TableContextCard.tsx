import React from 'react';

import { useOverhaulViewModel } from '../overhaul/useOverhaulViewModel';

import { useMessageContext } from '@/contexts/MessageContext';
import { useSceneBackground } from '@/contexts/SceneBackgroundContext';
import { tableImageUrl } from '@/features/campaigns/table/image-url';
import { TableImage } from '@/features/campaigns/table/TableImage';

export function TableContextCard({
  sessionId,
  compact = false,
}: {
  sessionId: string;
  compact?: boolean;
}): React.ReactElement {
  const { messages } = useMessageContext();
  const vm = useOverhaulViewModel({ sessionId, messages });
  const { currentBackgroundUrl } = useSceneBackground();
  const foe = vm.combat.active ? vm.combat.combatants.find((actor) => actor.isEnemy) : undefined;
  const scene = tableImageUrl(currentBackgroundUrl ?? null, 560, 320);
  const cover = tableImageUrl(vm.campaign.thumbnailUrl ?? null, 560, 320);
  const fallback = (
    <TableImage
      src={cover}
      alt=""
      width={560}
      height={320}
      className="my-2 w-full rounded object-cover"
      fallback={<p className="my-2 text-sm">Scene art unavailable</p>}
    />
  );
  return (
    <section
      data-testid="table-context-card"
      className={
        compact
          ? 'flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-[#a9823f] bg-[#0c1322] px-3 text-sm text-[#f6e3b8]'
          : 'min-w-0 rounded-xl border border-[#a9823f] bg-[#0c1322] p-3 text-[#f6e3b8]'
      }
    >
      <h2 className="font-heading text-base font-bold">{foe ? 'Enemy' : 'Scene'}</h2>
      {foe ? (
        <p>
          {foe.name} · {foe.healthCondition ?? 'condition unavailable'}
        </p>
      ) : (
        <>
          {!compact && (
            <TableImage
              src={scene}
              alt=""
              width={560}
              height={320}
              className="my-2 w-full rounded object-cover"
              fallback={fallback}
            />
          )}
          <p>{vm.campaign.regionLabel || vm.scene.title}</p>
        </>
      )}
    </section>
  );
}
