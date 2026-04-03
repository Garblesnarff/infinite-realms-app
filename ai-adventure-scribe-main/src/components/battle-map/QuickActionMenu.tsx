/* eslint-disable max-lines */
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

import type { QuickAction } from './hooks/use-quick-action-menu';

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
// Radial Position Calculator
// ===========================

/**
 * Calculate position for radial menu items
 */
function calculateRadialPosition(
  index: number,
  total: number,
  radius: number,
  offsetAngle: number = -90,
): { x: number; y: number; angle: number } {
  const angleStep = 360 / total;
  const angle = offsetAngle + angleStep * index;
  const radian = (angle * Math.PI) / 180;

  return {
    x: Math.cos(radian) * radius,
    y: Math.sin(radian) * radius,
    angle,
  };
}

// ===========================
// Radial Action Button
// ===========================

interface RadialActionButtonProps {
  action: QuickAction;
  position: { x: number; y: number; angle: number };
  index: number;
  onTrigger: () => void;
}

const RadialActionButton: React.FC<RadialActionButtonProps> = ({
  action,
  position,
  index,
  onTrigger,
}) => {
  const Icon = action.icon;
  const [isHovered, setIsHovered] = useState(false);

  const variantColors = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    success: 'bg-green-600 text-white hover:bg-green-700',
    warning: 'bg-yellow-600 text-white hover:bg-yellow-700',
  };

  const color = variantColors[action.variant || 'default'];

  return (
    <button
      type="button"
      onClick={onTrigger}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={action.enabled === false}
      className={cn(
        'absolute flex flex-col items-center justify-center gap-1 p-3 rounded-lg transition-all duration-200',
        'shadow-lg border-2 border-background',
        action.enabled === false && 'opacity-40 cursor-not-allowed',
        action.enabled !== false && color,
        isHovered && 'scale-110',
      )}
      style={{
        left: `calc(50% + ${position.x}px)`,
        top: `calc(50% + ${position.y}px)`,
        transform: 'translate(-50%, -50%)',
        zIndex: isHovered ? Z_INDEX.DROPDOWN : undefined,
        animation: `radialAppear 0.3s ease-out ${index * 0.05}s both`,
      }}
      aria-label={action.label}
      title={action.description || action.label}
    >
      <Icon className="h-5 w-5" />
      <span className="text-xs font-medium whitespace-nowrap">{action.label}</span>
      {action.shortcut && (
        <span className="text-[10px] font-mono opacity-75">{action.shortcut}</span>
      )}
    </button>
  );
};

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
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm"
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
          <button
            type="button"
            onClick={onClose}
            className="flex flex-col items-center justify-center gap-1 p-4 rounded-full bg-background border-2 border-border shadow-xl hover:bg-accent transition-colors"
            aria-label="Close menu"
            title="Close menu"
          >
            {CenterIcon ? (
              <CenterIcon className="h-6 w-6" />
            ) : (
              <div className="h-6 w-6 rounded-full bg-primary" />
            )}
            {centerLabel && <span className="text-xs font-medium">{centerLabel}</span>}
          </button>
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
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes radialAppear {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }

        @keyframes radialCenter {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
      `}</style>
    </>
  );
};

// ===========================
// Exports
// ===========================

export type { QuickActionMenuProps, QuickAction };
export type { UseQuickActionMenuOptions, UseQuickActionMenuReturn } from './hooks/use-quick-action-menu';
