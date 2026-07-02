/**
 * Quick Action Menu Component
 *
 * Radial menu for quick token actions.
 * Opens on right-click or hotkey (Q) and displays actions in a radial layout.
 *
 * Features:
 * - Right-click or hotkey (Q) to open
 * - Radial button layout (8 directions)
 * - Quick actions: Target, Move, Attack, Heal, Condition, Delete
 * - Close on selection or outside click
 * - Animated appearance
 * - Context-aware actions (hide unavailable actions)
 * - Visual feedback on hover
 *
 * @module components/battle-map/QuickActionMenu
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

import { QuickActionMenuAnimations } from './QuickActionMenuAnimations';
import { calculateRadialPosition, RadialActionButton } from './RadialActionButton';

import type { QuickAction } from './hooks/use-quick-action-menu';

import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Z_INDEX } from '@/constants/z-index';
import { cn } from '@/lib/utils';

// ===========================
// Types
// ===========================

export interface QuickActionMenuProps {
  /** Position where menu should appear */
  position: { x: number; y: number } | null;
  /** Available actions */
  actions: QuickAction[];
  /** Whether menu is open */
  isOpen: boolean;
  /** Callback when menu should close */
  onClose: () => void;
  /** Custom className */
  className?: string;
  /** Menu radius in pixels */
  radius?: number;
  /** Center button icon */
  centerIcon?: React.ComponentType<{ className?: string }>;
  /** Center button label */
  centerLabel?: string;
}

// ===========================
// Quick Action Menu Component
// ===========================

export const QuickActionMenu: React.FC<QuickActionMenuProps> = ({
  position,
  actions,
  isOpen,
  onClose,
  className,
  radius = 120,
  centerIcon: CenterIcon,
  centerLabel,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [enabledActions, setEnabledActions] = useState<QuickAction[]>([]);

  // Filter enabled actions
  useEffect((): void => {
    setEnabledActions(actions.filter((action) => action.enabled !== false));
  }, [actions]);

  // ===========================
  // Click Outside Handler
  // ===========================

  useEffect((): (() => void) | void => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Delay to avoid closing immediately on open
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // ===========================
  // Escape Key Handler
  // ===========================

  useEffect((): (() => void) | void => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // ===========================
  // Action Handler
  // ===========================

  const handleAction = useCallback(
    (action: QuickAction): void => {
      action.onAction();
      onClose();
    },
    [onClose],
  );

  // ===========================
  // Render
  // ===========================

  if (!isOpen || !position) {
    return null;
  }

  return (
    <TooltipProvider>
      <>
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm"
          aria-hidden="true"
          style={{
            zIndex: Z_INDEX.MODAL_BACKDROP,
            animation: 'fadeIn 0.2s ease-out',
          }}
        />

        {/* Menu Container */}
        <div
          ref={menuRef}
          className={cn('fixed', className)}
          style={{
            left: position.x,
            top: position.y,
            width: radius * 2.5,
            height: radius * 2.5,
            transform: 'translate(-50%, -50%)',
            zIndex: Z_INDEX.MODAL,
          }}
        >
          {/* Center Button */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              animation: 'radialCenter 0.3s ease-out',
              zIndex: Z_INDEX.CARD_HOVER,
            }}
          >
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex flex-col items-center justify-center gap-1 p-4 rounded-full bg-background border-2 border-border shadow-xl hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple focus-visible:ring-offset-2"
                  aria-label="Close menu"
                >
                  {CenterIcon ? (
                    <CenterIcon className="h-6 w-6" aria-hidden="true" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-primary" aria-hidden="true" />
                  )}
                  {centerLabel && <span className="text-xs font-medium">{centerLabel}</span>}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Close menu</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Radial Action Buttons */}
          {enabledActions.map((action, index) => {
            const pos = calculateRadialPosition(index, enabledActions.length, radius);
            return (
              <RadialActionButton
                key={action.id}
                action={action}
                position={pos}
                index={index}
                onTrigger={() => handleAction(action)}
              />
            );
          })}
        </div>

        {/* CSS Animations */}
        <QuickActionMenuAnimations />
      </>
    </TooltipProvider>
  );
};

// ===========================
// Exports
// ===========================

export type { QuickActionMenuProps, QuickAction };
export type {
  UseQuickActionMenuOptions,
  UseQuickActionMenuReturn,
} from './hooks/use-quick-action-menu';
