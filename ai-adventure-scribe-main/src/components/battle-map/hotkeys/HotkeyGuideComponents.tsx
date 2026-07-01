import React from 'react';

import type { ShortcutInfo } from './constants';

import { Badge } from '@/components/ui/badge';

// ===========================
// Shortcut Item Component
// ===========================

export interface ShortcutItemProps {
  shortcut: ShortcutInfo;
  searchQuery?: string;
}

export const ShortcutItem: React.FC<ShortcutItemProps> = ({ shortcut, searchQuery }) => {
  const { keys, description, notes, gmOnly } = shortcut;

  // Highlight search matches
  const highlightText = (text: string) => {
    if (!searchQuery) return text;

    const regex = new RegExp(`(${searchQuery})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className="bg-yellow-200">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  return (
    <div className="flex items-center justify-between py-2 px-3 hover:bg-accent rounded-md transition-colors">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">{highlightText(description)}</span>
          {gmOnly && (
            <Badge variant="outline" className="text-xs">
              GM
            </Badge>
          )}
        </div>
        {notes && <span className="text-xs text-muted-foreground">{notes}</span>}
      </div>
      <div className="flex items-center gap-1">
        {keys.map((key, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className="text-xs text-muted-foreground mx-1">+</span>}
            <kbd className="px-2 py-1 text-xs font-mono bg-muted border border-border rounded shadow-sm">
              {key}
            </kbd>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

// ===========================
// Category Section Component
// ===========================

export interface CategorySectionProps {
  category: string;
  shortcuts: ShortcutInfo[];
  searchQuery?: string;
}

export const CategorySection: React.FC<CategorySectionProps> = ({
  category,
  shortcuts,
  searchQuery,
}) => {
  if (shortcuts.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {category}
      </h3>
      <div className="space-y-1">
        {shortcuts.map((shortcut, index) => (
          <ShortcutItem key={index} shortcut={shortcut} searchQuery={searchQuery} />
        ))}
      </div>
    </div>
  );
};
