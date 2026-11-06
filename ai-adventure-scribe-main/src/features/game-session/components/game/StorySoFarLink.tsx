import React, { useState } from 'react';

import ChronicleViewer from '@/components/chronicles/ChronicleViewer';

interface StorySoFarLinkProps {
  sessionId: string;
}

/**
 * Journal entry that opens this session's chronicle in the chronicle dialog.
 * The viewer is mounted only while open, so the chronicle query runs on demand.
 */
export const StorySoFarLink: React.FC<StorySoFarLinkProps> = ({ sessionId }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Story so far
        </h3>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-left hover:bg-muted/40"
        >
          <span>
            <span className="block text-sm font-semibold">Read the chronicle</span>
            <span className="block text-xs text-muted-foreground">Story so far</span>
          </span>
        </button>
      </div>
      {open && <ChronicleViewer sessionId={sessionId} open onClose={() => setOpen(false)} />}
    </>
  );
};
