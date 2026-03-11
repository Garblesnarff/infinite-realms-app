import { Target, Move, Sword, Heart, Skull, Trash2, Shield, Eye } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';

import type { MouseEvent, ComponentType } from 'react';

import { useHotkeys, BATTLE_MAP_HOTKEYS } from '@/hooks/use-hotkeys';
import logger from '@/lib/logger';

// ===========================
// Types
// ===========================

export interface QuickAction {
  /** Action identifier */
  id: string;
  /** Action label */
  label: string;
  /** Icon component */
  icon: ComponentType<{ className?: string }>;
  /** Callback when action is triggered */
  onAction: () => void;
  /** Whether action is enabled */
  enabled?: boolean;
  /** Keyboard shortcut */
  shortcut?: string;
  /** Description */
  description?: string;
  /** Visual variant */
  variant?: 'default' | 'danger' | 'success' | 'warning';
}

export interface UseQuickActionMenuOptions {
  /** Available actions */
  actions: QuickAction[];
  /** Enable right-click to open */
  enableRightClick?: boolean;
  /** Enable hotkey to open (Q) */
  enableHotkey?: boolean;
  /** Custom hotkey */
  hotkeyConfig?: { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean };
  /** Callback when menu opens */
  onOpen?: (position: { x: number; y: number }) => void;
  /** Callback when menu closes */
  onClose?: () => void;
}

export interface UseQuickActionMenuReturn {
  /** Whether menu is open */
  isOpen: boolean;
  /** Menu position */
  position: { x: number; y: number } | null;
  /** Open menu at position */
  openMenu: (position: { x: number; y: number }) => void;
  /** Close menu */
  closeMenu: () => void;
  /** Context menu event handler */
  onContextMenu: (event: MouseEvent) => void;
}

/**
 * Hook for managing quick action menu state
 */
export function useQuickActionMenu(options: UseQuickActionMenuOptions): UseQuickActionMenuReturn {
  const { enableRightClick = true, enableHotkey = true, hotkeyConfig, onOpen, onClose } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Track mouse position
  useEffect((): (() => void) => {
    const handleMouseMove = (event: MouseEvent): void => {
      lastMousePosRef.current = { x: event.clientX, y: event.clientY };
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const openMenu = useCallback(
    (pos: { x: number; y: number }): void => {
      setPosition(pos);
      setIsOpen(true);
      onOpen?.(pos);
    },
    [onOpen],
  );

  const closeMenu = useCallback((): void => {
    setIsOpen(false);
    setPosition(null);
    onClose?.();
  }, [onClose]);

  // Hotkey to open menu at mouse position
  useHotkeys({
    hotkeys: enableHotkey
      ? [
          {
            ...(hotkeyConfig || BATTLE_MAP_HOTKEYS.QUICK_MENU),
            callback: () => {
              if (!isOpen) {
                openMenu(lastMousePosRef.current);
              } else {
                closeMenu();
              }
            },
          },
        ]
      : [],
    enabled: enableHotkey,
  });

  // Context menu handler
  const onContextMenu = useCallback(
    (event: MouseEvent): void => {
      if (!enableRightClick) return;

      event.preventDefault();
      event.stopPropagation();

      if (isOpen) {
        closeMenu();
      } else {
        openMenu({ x: event.clientX, y: event.clientY });
      }
    },
    [enableRightClick, isOpen, openMenu, closeMenu],
  );

  return {
    isOpen,
    position,
    openMenu,
    closeMenu,
    onContextMenu,
  };
}

/**
 * Default quick actions for tokens
 */
export function getDefaultQuickActions(tokenId: string, isGM: boolean = false): QuickAction[] {
  return [
    {
      id: 'target',
      label: 'Target',
      icon: Target,
      shortcut: 'T',
      description: 'Target this token',
      onAction: () => {
        logger.debug('Target token:', { tokenId });
      },
    },
    {
      id: 'move',
      label: 'Move',
      icon: Move,
      shortcut: 'M',
      description: 'Move this token',
      onAction: () => {
        logger.debug('Move token:', { tokenId });
      },
    },
    {
      id: 'attack',
      label: 'Attack',
      icon: Sword,
      shortcut: 'A',
      description: 'Attack with this token',
      variant: 'danger',
      onAction: () => {
        logger.debug('Attack with token:', { tokenId });
      },
    },
    {
      id: 'heal',
      label: 'Heal',
      icon: Heart,
      shortcut: 'H',
      description: 'Heal this token',
      variant: 'success',
      onAction: () => {
        logger.debug('Heal token:', { tokenId });
      },
    },
    {
      id: 'condition',
      label: 'Condition',
      icon: Shield,
      shortcut: 'C',
      description: 'Apply condition',
      variant: 'warning',
      onAction: () => {
        logger.debug('Apply condition to token:', { tokenId });
      },
    },
    {
      id: 'visibility',
      label: 'Hide',
      icon: Eye,
      shortcut: 'V',
      description: 'Toggle visibility',
      enabled: isGM,
      onAction: () => {
        logger.debug('Toggle visibility for token:', { tokenId });
      },
    },
    {
      id: 'damage',
      label: 'Damage',
      icon: Skull,
      shortcut: 'D',
      description: 'Apply damage',
      variant: 'danger',
      onAction: () => {
        logger.debug('Apply damage to token:', { tokenId });
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash2,
      shortcut: 'Del',
      description: 'Delete this token',
      variant: 'danger',
      enabled: isGM,
      onAction: () => {
        logger.debug('Delete token:', { tokenId });
      },
    },
  ];
}
