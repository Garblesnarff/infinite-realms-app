import { ArrowRight } from 'lucide-react';
import React, { useState } from 'react';

import ChronicleViewer from '@/components/chronicles/ChronicleViewer';

interface StorySoFarLinkProps {
  sessionId: string;
}

/**
 * Journal entry that opens this session's chronicle in the chronicle dialog.
 * The viewer is mounted only while open, so the chronicle query runs on demand.
 * From the cloud session's commit 5c957c7 (claude/design-implementation-a2qxny),
 * restyled to the Panels board's link card (#1429).
 */
export const StorySoFarLink: React.FC<StorySoFarLinkProps> = ({ sessionId }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground [body.ir-table-look_&]:tracking-[0.14em] [body.ir-table-look_&]:!text-[#aab3cc]">
          Story so far
        </h3>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-left hover:bg-muted/40 [body.ir-table-look_&]:min-h-16 [body.ir-table-look_&]:rounded-[12px] [body.ir-table-look_&]:border-transparent [body.ir-table-look_&]:bg-[#121b30] [body.ir-table-look_&]:px-[14px] [body.ir-table-look_&]:shadow-[0_0_0_1px_rgba(213,176,112,0.3)]"
        >
          <span>
            <span className="block text-sm font-semibold [body.ir-table-look_&]:text-base [body.ir-table-look_&]:font-bold [body.ir-table-look_&]:text-[#eaeefa]">
              Read the chronicle
            </span>
            <span className="block text-xs text-muted-foreground [body.ir-table-look_&]:text-sm [body.ir-table-look_&]:!text-[#aab3cc]">
              Story so far
            </span>
          </span>
          <ArrowRight
            className="h-[18px] w-[18px] flex-none text-infinite-gold [body.ir-table-look_&]:text-[#d5b070]"
            aria-hidden="true"
          />
        </button>
      </div>
      {open && <ChronicleViewer sessionId={sessionId} open onClose={() => setOpen(false)} />}
    </>
  );
};
