import React from 'react';

import { cn } from '@/lib/utils';

export interface HotkeyBadgeProps {
  /** Keyboard keys */
  keys: string[];
  /** Custom className */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Display keyboard shortcut in a badge
 */
/**
 * ⚡ Bolt: Wrapped in React.memo as it is a pure UI component frequently rendered
 * in lists and toolbars, ensuring it only re-renders when keys or styling change.
 */
export const HotkeyBadge: React.FC<HotkeyBadgeProps> = React.memo(
  ({ keys, className, size = 'md' }) => {
    const sizeClasses = {
      sm: 'px-1.5 py-0.5 text-[10px]',
      md: 'px-2 py-1 text-xs',
      lg: 'px-2.5 py-1.5 text-sm',
    };

    return (
      <div className={cn('inline-flex items-center gap-0.5', className)}>
        {keys.map((key, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className="text-xs text-muted-foreground mx-0.5">+</span>}
            <kbd
              className={cn(
                'font-mono bg-muted border border-border rounded shadow-sm',
                sizeClasses[size],
              )}
            >
              {key}
            </kbd>
          </React.Fragment>
        ))}
      </div>
    );
  },
);
