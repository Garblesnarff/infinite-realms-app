import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

import { Z_INDEX } from '@/constants/z-index';
import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => {
  // See dialog.tsx for the full rationale: the navy+gold theme tokens are
  // scoped to `.ir-app` (the authenticated /app/* wrapper), but Radix's
  // Portal defaults to document.body, which sits outside `.ir-app` — so
  // popovers rendered from within the app fell back to the :root
  // (light/marketing) `--popover` value (white). Portal into the nearest
  // `.ir-app` element when one exists; pages without it (marketing,
  // /explore/*, /admin/blog) get `undefined` and keep the normal
  // document.body portal.
  const [irAppContainer] = React.useState<HTMLElement | undefined>(() =>
    typeof document !== 'undefined'
      ? (document.querySelector<HTMLElement>('.ir-app') ?? undefined)
      : undefined,
  );

  return (
    <PopoverPrimitive.Portal container={irAppContainer}>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        style={{ zIndex: Z_INDEX.POPOVER }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
