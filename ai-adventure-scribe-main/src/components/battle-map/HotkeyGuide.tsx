/**
 * Hotkey Guide Component
 *
 * Help overlay that displays all available keyboard shortcuts.
 * Press '?' to show/hide. Organized by category and searchable.
 *
 * Features:
 * - Press '?' to show/hide
 * - All keyboard shortcuts listed
 * - Organized by category (Tools, Actions, View, Layers, Tokens)
 * - Searchable shortcuts
 * - GM-only shortcuts visibility
 * - Responsive layout
 * - Keyboard navigation
 *
 * @module components/battle-map/HotkeyGuide
 */

import { Search, Keyboard } from 'lucide-react';
import React, { useState, useMemo } from 'react';

import { SHORTCUTS, CATEGORY_ORDER } from './hotkeys/constants';
import { CategorySection } from './hotkeys/HotkeyGuideComponents';

import type { ShortcutInfo } from './hotkeys/constants';
import type { HotkeyBadgeProps } from './hotkeys/HotkeyBadge';

import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { cn } from '@/lib/utils';

// ===========================
// Re-exports
// ===========================

export { HotkeyBadge } from './hotkeys/HotkeyBadge';
export type { HotkeyBadgeProps, ShortcutInfo };

// ===========================
// Types
// ===========================

export interface HotkeyGuideProps {
  /** Whether user is GM */
  isGM?: boolean;
  /** Custom className */
  className?: string;
  /** Initial open state */
  defaultOpen?: boolean;
  /** Controlled open state */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
}

// ===========================
// Hotkey Guide Component
// ===========================

export const HotkeyGuide: React.FC<HotkeyGuideProps> = ({
  isGM = false,
  className,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [searchQuery, setSearchQuery] = useState('');

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const handleOpenChange = (open: boolean) => {
    if (controlledOpen === undefined) {
      setInternalOpen(open);
    }
    onOpenChange?.(open);
  };

  // Hotkey to toggle guide
  useHotkeys({
    hotkeys: [
      {
        key: '?',
        description: 'Toggle hotkey guide',
        callback: () => handleOpenChange(!isOpen),
      },
    ],
    enabled: true,
  });

  // Filter shortcuts
  const filteredShortcuts = useMemo(() => {
    let shortcuts = SHORTCUTS;

    // Filter GM-only shortcuts
    if (!isGM) {
      shortcuts = shortcuts.filter((s) => !s.gmOnly);
    }

    // Filter by search query
    if (searchQuery) {
      shortcuts = shortcuts.filter(
        (s) =>
          s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.keys.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase())),
      );
    }

    return shortcuts;
  }, [isGM, searchQuery]);

  // Group by category
  const categorizedShortcuts = useMemo(() => {
    const categories = new Map<string, ShortcutInfo[]>();

    filteredShortcuts.forEach((shortcut) => {
      const category = shortcut.category;
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(shortcut);
    });

    return categories;
  }, [filteredShortcuts]);

  // ===========================
  // Render
  // ===========================

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className={cn('max-w-2xl max-h-[80vh] flex flex-col', className)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>All available keyboard shortcuts for the battle map</DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search shortcuts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Shortcuts List */}
        <div className="flex-1 overflow-y-auto space-y-6 pr-2">
          {CATEGORY_ORDER.map((category) => {
            const shortcuts = categorizedShortcuts.get(category) || [];
            return (
              <CategorySection
                key={category}
                category={category}
                shortcuts={shortcuts}
                searchQuery={searchQuery}
              />
            );
          })}

          {/* No Results */}
          {filteredShortcuts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No shortcuts found matching "{searchQuery}"</p>
            </div>
          )}
        </div>

        <Separator />

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Keyboard className="h-3 w-3" />
            <span>Press ? to toggle this guide</span>
          </div>
          <div className="flex items-center gap-2">
            <span>{filteredShortcuts.length} shortcuts</span>
            {isGM && (
              <>
                <Separator orientation="vertical" className="h-3" />
                <Badge variant="outline" className="text-xs">
                  GM Mode
                </Badge>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
