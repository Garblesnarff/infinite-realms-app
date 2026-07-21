import { User, Sword, Heart, BookOpen, Wand2 } from 'lucide-react';
import React from 'react';

import type { StarterCharacterTemplate } from '@/hooks/use-starter-character-templates';

/**
 * Get class icon component
 */
export function getClassIcon(className: string): React.ReactNode {
  const iconProps = { className: 'w-5 h-5' };
  switch (className.toLowerCase()) {
    case 'fighter':
    case 'ranger':
    case 'barbarian':
    case 'paladin':
      return <Sword {...iconProps} />;
    case 'cleric':
    case 'druid':
      return <Heart {...iconProps} />;
    case 'wizard':
    case 'warlock':
    case 'sorcerer':
      return <Wand2 {...iconProps} />;
    case 'bard':
    case 'rogue':
      return <BookOpen {...iconProps} />;
    default:
      return <User {...iconProps} />;
  }
}

/**
 * Character Card Component
 */
export interface StarterCharacterCardProps {
  template: StarterCharacterTemplate;
  isSelected: boolean;
  onSelect: () => void;
}

export const StarterCharacterCard: React.FC<StarterCharacterCardProps> = ({
  template,
  isSelected,
  onSelect,
}) => {
  const accessibleName = `Select ${template.name}, ${template.race} ${template.class}`;

  return (
    <button
      onClick={onSelect}
      type="button"
      aria-pressed={isSelected}
      aria-label={accessibleName}
      className={`relative flex flex-col items-center p-4 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] text-left w-full outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple ${
        isSelected
          ? 'border-infinite-gold bg-infinite-gold/20 shadow-lg shadow-infinite-gold/20'
          : 'border-border bg-card hover:border-infinite-gold/40 hover:bg-secondary/10'
      }`}
    >
      {/* Portrait Placeholder */}
      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-infinite-purple/30 to-infinite-gold/30 flex items-center justify-center mb-3 border-2 border-border">
        {template.portraitUrl ? (
          <img
            src={template.portraitUrl}
            alt={template.name}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <div className="text-3xl text-muted-foreground">{getClassIcon(template.class)}</div>
        )}
      </div>

      {/* Name and Class */}
      <h3 className="text-lg font-bold text-foreground text-center">{template.name}</h3>
      <p className="text-sm text-infinite-gold mb-1">
        {template.race} {template.class}
      </p>
      <p className="text-xs text-muted-foreground text-center line-clamp-2">{template.tagline}</p>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2 w-6 h-6 bg-infinite-gold rounded-full flex items-center justify-center">
          <svg
            className="w-4 h-4 text-infinite-dark"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </button>
  );
};
