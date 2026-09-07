import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';

import { Z_INDEX } from '@/constants/z-index';
import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  // See dialog.tsx: navy+gold tokens are scoped to `.ir-app`. Portal into that
  // wrapper when present so tooltips inherit the themed `--popover` values;
  // otherwise fall back to document.body. Either way the content is positioned
  // (never in the trigger's layout flow), so hover cannot resize a parent card.
  const [irAppContainer] = React.useState<HTMLElement | undefined>(() =>
    typeof document !== 'undefined'
      ? (document.querySelector<HTMLElement>('.ir-app') ?? undefined)
      : undefined,
  );

  return (
    <TooltipPrimitive.Portal container={irAppContainer}>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        style={{ zIndex: Z_INDEX.TOOLTIP }}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
