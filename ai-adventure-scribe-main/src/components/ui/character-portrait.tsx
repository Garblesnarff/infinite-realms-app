/**
 * CharacterPortrait Component
 *
 * Unified character avatar display with optional stats overlay.
 * Used in campaign cards, character sheets, game session headers, etc.
 *
 * Usage:
 * <CharacterPortrait
 *   name="Aragorn"
 *   race="Human"
 *   class="Ranger"
 *   level={5}
 *   size="md"
 *   showStats
 * />
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { motion } from 'framer-motion';
import { User } from 'lucide-react';
import * as React from 'react';

import { Badge } from './badge';
import { CharacterPortraitHoverDetails } from './character-portrait-hover-details';
import { CharacterPortraitStatsOverlay } from './character-portrait-stats-overlay';
import { CharacterPortraitStatusEffects } from './character-portrait-status-effects';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

import { Z_INDEX } from '@/constants/z-index';
import { cn } from '@/lib/utils';

const characterPortraitVariants = cva(
  'relative inline-flex items-center justify-center rounded-lg overflow-hidden bg-gradient-to-br from-muted to-muted/60 transition-all duration-300',
  {
    variants: {
      size: {
        xs: 'h-8 w-8 text-xs',
        sm: 'h-12 w-12 text-sm',
        md: 'h-16 w-16 text-base',
        lg: 'h-24 w-24 text-lg',
        xl: 'h-32 w-32 text-xl',
        '2xl': 'h-40 w-40 text-2xl',
      },
      variant: {
        default: 'border-2 border-border',
        fantasy: 'border-2 border-amber-200/50 shadow-md',
        cosmic: 'border-2 border-infinite-purple/30 shadow-lg shadow-infinite-purple/20',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
    },
  },
);

export interface CharacterPortraitProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof characterPortraitVariants> {
  /** Character name */
  name: string;
  /** Character race */
  race?: string;
  /** Character class */
  class?: string;
  /** Character level */
  level?: number;
  /** Image URL */
  imageUrl?: string;
  /** Show stats overlay */
  showStats?: boolean;
  /** HP (current) */
  hp?: number;
  /** HP (max) */
  maxHp?: number;
  /** AC */
  ac?: number;
  /** Initiative */
  initiative?: number;
  /** Status effects */
  status?: string[];
  /** Show character details on hover */
  showDetailsOnHover?: boolean;
  /** Animate on mount */
  animate?: boolean;
}

const CharacterPortrait = React.forwardRef<HTMLDivElement, CharacterPortraitProps>(
  (
    {
      className,
      size,
      variant,
      name,
      race,
      class: characterClass,
      level,
      imageUrl,
      showStats = false,
      hp,
      maxHp,
      ac,
      initiative,
      status = [],
      showDetailsOnHover = false,
      animate = true,
      ...props
    },
    ref,
  ) => {
    const [isHovered, setIsHovered] = React.useState(false);

    // Generate initials from name
    const initials = name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    const containerVariants = {
      hidden: { opacity: 0, scale: 0.8 },
      visible: {
        opacity: 1,
        scale: 1,
        transition: {
          duration: 0.3,
          ease: [0.4, 0, 0.2, 1],
        },
      },
    };

    const Content = (
      <>
        {/* Avatar */}
        {imageUrl ? (
          <img src={imageUrl} alt={name} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex items-center justify-center text-muted-foreground font-semibold">
            {initials || <User className="h-1/2 w-1/2" />}
          </div>
        )}

        {/* Level Badge */}
        {level !== undefined && (
          <div className="absolute top-1 left-1" style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="purple"
                  className="text-xs font-bold px-1.5 py-0.5 cursor-help focus-visible:ring-2 focus-visible:ring-infinite-purple outline-none"
                  aria-label={`Level ${level}`}
                  tabIndex={0}
                >
                  {level}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Level {level}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Stats Overlay (Bottom) */}
        {showStats && (
          <CharacterPortraitStatsOverlay hp={hp} maxHp={maxHp} ac={ac} initiative={initiative} />
        )}

        {/* Status Effects */}
        <CharacterPortraitStatusEffects status={status} />

        {/* Hover Details */}
        {showDetailsOnHover && isHovered && (
          <CharacterPortraitHoverDetails
            name={name}
            race={race}
            characterClass={characterClass}
            level={level}
          />
        )}

        {/* Glow Effect on Hover */}
        <div
          className={cn(
            'absolute inset-0 rounded-lg opacity-0 transition-opacity duration-300 pointer-events-none',
            'bg-gradient-to-br from-infinite-purple/20 to-infinite-teal/20',
            isHovered && 'opacity-100',
          )}
        />
      </>
    );

    if (animate) {
      return (
        <motion.div
          ref={ref}
          className={cn(characterPortraitVariants({ size, variant }), className)}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          whileHover={{ scale: 1.05 }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          {...props}
        >
          {Content}
        </motion.div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(characterPortraitVariants({ size, variant }), className)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        {...props}
      >
        {Content}
      </div>
    );
  },
);

CharacterPortrait.displayName = 'CharacterPortrait';

export { CharacterPortrait, characterPortraitVariants };
