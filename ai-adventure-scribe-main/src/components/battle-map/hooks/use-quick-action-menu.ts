import { useState, useEffect, useRef, useCallback } from 'react';

import type { ComponentType, MouseEvent as ReactMouseEvent } from 'react';

import { useHotkeys, BATTLE_MAP_HOTKEYS } from '@/hooks/use-hotkeys';

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
  onContextMenu: (event: ReactMouseEvent) => void;
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
    const handleMouseMove = (event: globalThis.MouseEvent): void => {
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
    (event: ReactMouseEvent): void => {
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
