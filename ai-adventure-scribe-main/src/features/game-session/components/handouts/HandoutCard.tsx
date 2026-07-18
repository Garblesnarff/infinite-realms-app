import * as DialogPrimitive from '@radix-ui/react-dialog';
import { BookOpen, ScrollText, X } from 'lucide-react';
import React from 'react';

import type { JournalHandoutEntry } from '@/services/user-data-api';

import { Z_INDEX } from '@/constants/z-index';
import { getPublicUrl } from '@/infrastructure/storage';
import { cn } from '@/lib/utils';

const imageUrlFor = (entry: JournalHandoutEntry): string | null =>
  entry.assetPath ? getPublicUrl('campaign-images', entry.assetPath).publicUrl : null;

export const HandoutCard: React.FC<{ entry: JournalHandoutEntry; className?: string }> = ({
  entry,
  className,
}) => {
  const [open, setOpen] = React.useState(false);
  const imageUrl = imageUrlFor(entry);
  const authored = entry.mode === 'authored';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group w-full overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5 hover:shadow-lg',
          authored
            ? 'border-amber-300/25 bg-gradient-to-br from-amber-950/45 to-[#1b1428]'
            : 'border-amber-700/35 bg-[#f3e5c1] text-stone-900',
          className,
        )}
      >
        {authored && imageUrl ? (
          <img src={imageUrl} alt={entry.title} className="h-32 w-full object-cover" />
        ) : (
          <div className="border-b border-amber-900/20 bg-[radial-gradient(circle_at_top,_#fff6d6,_#dfc48c)] px-4 py-3">
            <div className="flex items-center gap-2 text-amber-900">
              <ScrollText className="h-4 w-4" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Handout</span>
            </div>
          </div>
        )}
        <div className={cn('p-4', authored ? 'text-white' : 'text-stone-900')}>
          <h4 className="font-display font-semibold">{entry.title}</h4>
          <p className={cn('mt-1 text-xs', authored ? 'text-amber-100/70' : 'text-stone-600')}>
            Given by {entry.giver}
          </p>
          {!authored && entry.body && (
            <p className="mt-3 line-clamp-3 text-sm leading-6">{entry.body}</p>
          )}
        </div>
      </button>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/90 backdrop-blur-md"
          style={{ zIndex: Z_INDEX.IMAGE_LIGHTBOX_BACKDROP }}
        />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 max-h-[90vh] w-[min(92vw,42rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-amber-200/20 bg-[#16101f] p-0 shadow-2xl focus:outline-none"
          style={{ zIndex: Z_INDEX.IMAGE_LIGHTBOX }}
        >
          <DialogPrimitive.Title className="sr-only">{entry.title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Handout given by {entry.giver}
          </DialogPrimitive.Description>
          <DialogPrimitive.Close
            className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white/80 hover:bg-black/70 hover:text-white"
            style={{ zIndex: Z_INDEX.POPOVER }}
            aria-label={`Close ${entry.title}`}
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
          {authored && imageUrl ? (
            <img src={imageUrl} alt={entry.title} className="max-h-[72vh] w-full object-contain" />
          ) : (
            <article className="min-h-80 bg-[radial-gradient(circle_at_top,_#fff8dc,_#ddbf81)] p-8 text-stone-900">
              <div className="mb-5 flex items-center gap-2 text-amber-900">
                <BookOpen className="h-5 w-5" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">A handout</span>
              </div>
              <h3 className="font-display text-2xl font-bold">{entry.title}</h3>
              <p className="mt-1 text-sm text-stone-600">Given by {entry.giver}</p>
              <p className="mt-6 whitespace-pre-wrap font-serif text-lg leading-8">{entry.body}</p>
            </article>
          )}
          {authored && (
            <div className="p-5 text-white">
              <h3 className="font-display text-xl font-semibold">{entry.title}</h3>
              <p className="mt-1 text-sm text-amber-100/70">Given by {entry.giver}</p>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
