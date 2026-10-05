import { PanelLeft } from 'lucide-react';
import * as React from 'react';

import { useSidebar, SIDEBAR_WIDTH_MOBILE } from './sidebar-context';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Z_INDEX } from '@/constants/z-index';
import { cn } from '@/lib/utils';

export const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & {
    side?: 'left' | 'right';
    variant?: 'sidebar' | 'floating' | 'inset';
    collapsible?: 'offcanvas' | 'icon' | 'none';
  }
>(
  (
    {
      side = 'left',
      variant = 'sidebar',
      collapsible = 'offcanvas',
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

    if (collapsible === 'none') {
      return (
        <div
          className={cn(
            'flex h-full w-[--sidebar-width] flex-col bg-sidebar text-sidebar-foreground',
            className,
          )}
          ref={ref}
          {...props}
        >
          {children}
        </div>
      );
    }

    if (isMobile) {
      return (
        <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
          <SheetContent
            data-sidebar="sidebar"
            data-mobile="true"
            className="w-[--sidebar-width] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
            style={
              {
                '--sidebar-width': SIDEBAR_WIDTH_MOBILE,
              } as React.CSSProperties
            }
            side={side}
          >
            <SheetTitle className="sr-only">Sidebar</SheetTitle>
            <SheetDescription className="sr-only">Navigation sidebar.</SheetDescription>
            <div className="flex h-full w-full flex-col">{children}</div>
          </SheetContent>
        </Sheet>
      );
    }

    return (
      <div
        ref={ref}
        className="group peer hidden md:block text-sidebar-foreground"
        data-state={state}
        data-collapsible={state === 'collapsed' ? collapsible : ''}
        data-variant={variant}
        data-side={side}
      >
        {/* This is what handles the sidebar gap on desktop */}
        <div
          className={cn(
            'duration-200 relative h-svh w-[--sidebar-width] bg-transparent transition-[width] ease-linear',
            'group-data-[collapsible=offcanvas]:w-0',
            'group-data-[side=right]:rotate-180',
            variant === 'floating' || variant === 'inset'
              ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]'
              : 'group-data-[collapsible=icon]:w-[--sidebar-width-icon]',
          )}
        />
        <div
          style={{ zIndex: Z_INDEX.SIDEBAR }}
          className={cn(
            'duration-200 fixed inset-y-0 hidden h-svh w-[--sidebar-width] transition-[left,right,width] ease-linear md:flex',
            side === 'left'
              ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
              : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
            // Adjust the padding for floating and inset variants.
            variant === 'floating' || variant === 'inset'
              ? 'p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]'
              : 'group-data-[collapsible=icon]:w-[--sidebar-width-icon] group-data-[side=left]:border-r group-data-[side=right]:border-l',
            className,
          )}
          {...props}
        >
          <div
            data-sidebar="sidebar"
            className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
          >
            {children}
          </div>
        </div>
      </div>
    );
  },
);
Sidebar.displayName = 'Sidebar';

export const SidebarTrigger = React.forwardRef<
  React.ElementRef<typeof Button>,
  React.ComponentProps<typeof Button>
>(({ className, onClick, ...props }, ref) => {
  const { toggleSidebar, open } = useSidebar();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          data-sidebar="trigger"
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', className)}
          onClick={(event) => {
            onClick?.(event);
            toggleSidebar();
          }}
          aria-label="Toggle Sidebar (Ctrl+B)"
          aria-expanded={open}
          {...props}
        >
          <PanelLeft />
          <span className="sr-only">Toggle Sidebar (Ctrl+B)</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" align="center">
        <p>Toggle Sidebar (Ctrl+B)</p>
      </TooltipContent>
    </Tooltip>
  );
});
SidebarTrigger.displayName = 'SidebarTrigger';

export const SidebarRail = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(
  ({ className, ...props }, ref) => {
    const { toggleSidebar, open } = useSidebar();

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={ref}
            data-sidebar="rail"
            aria-label="Toggle Sidebar (Ctrl+B)"
            aria-expanded={open}
            tabIndex={-1}
            onClick={toggleSidebar}
            style={{ zIndex: Z_INDEX.CARD_HOVER }}
            className={cn(
              'absolute inset-y-0 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex',
              '[[data-side=left]_&]:cursor-w-resize [[data-side=right]_&]:cursor-e-resize',
              '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
              'group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full group-data-[collapsible=offcanvas]:hover:bg-sidebar',
              '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
              '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
              className,
            )}
            {...props}
          />
        </TooltipTrigger>
        <TooltipContent side="right" align="center">
          <p>Toggle Sidebar (Ctrl+B)</p>
        </TooltipContent>
      </Tooltip>
    );
  },
);
SidebarRail.displayName = 'SidebarRail';
