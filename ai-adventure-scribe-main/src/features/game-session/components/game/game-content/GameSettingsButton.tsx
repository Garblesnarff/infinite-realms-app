import { Settings } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { PlayerSettings } from '@/features/settings/PlayerSettings';

/**
 * Gear in the game top bar. Opens the same settings the Campaign Hub tab shows.
 * Under 700px the sheet fills the screen with a 44px Close; from 700px it is a 420px right drawer.
 */
export const GameSettingsButton: React.FC = () => {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="ir-hit" aria-label="Settings">
          <Settings className="h-4 w-4" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      {open ? (
        <SheetContent
          side="right"
          className="max-[699px]:w-full max-[699px]:max-w-none max-[699px]:border-l-0 min-[700px]:w-[420px] min-[700px]:max-w-[420px]"
        >
          <SheetHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle>Settings</SheetTitle>
                <SheetDescription>
                  Table and narration preferences for this browser.
                </SheetDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 min-w-11 shrink-0 px-4"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </div>
          </SheetHeader>
          <PlayerSettings />
        </SheetContent>
      ) : null}
    </Sheet>
  );
};
