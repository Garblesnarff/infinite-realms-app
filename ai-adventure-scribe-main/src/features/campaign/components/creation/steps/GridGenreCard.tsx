import { Check } from 'lucide-react';
import React from 'react';

import { type GenreCardProps } from './ListGenreCard';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { Z_INDEX } from '@/constants/z-index';

interface GridGenreCardProps extends GenreCardProps {
  hovered: string | null;
  setHovered: (value: string | null) => void;
}

export const GridGenreCard: React.FC<GridGenreCardProps> = ({
  genre,
  isSelected,
  hovered,
  setHovered,
  onGenreChange,
}) => (
  <Card
    key={genre.value}
    className={`group cursor-pointer transition-all hover:shadow-xl border-2 relative overflow-hidden aspect-square ${
      isSelected ? 'border-primary shadow-lg' : 'border-border/30 hover:border-infinite-purple/50'
    }`}
    style={{
      padding: 0,
      ...(genre.backgroundImage
        ? {
            backgroundImage: `url(${genre.backgroundImage}), url('/campaign-background-placeholder.png')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }
        : {}),
    }}
    onClick={() => onGenreChange(genre.value)}
    onMouseEnter={() => setHovered(genre.value)}
    onMouseLeave={() => setHovered(null)}
    role="radio"
    aria-checked={isSelected}
    aria-label={`${genre.label}: ${genre.description}`}
    title={genre.label}
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') onGenreChange(genre.value);
    }}
  >
    <RadioGroupItem
      value={genre.value}
      id={genre.value}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
    />
    <div
      className="absolute inset-0"
      style={{ boxShadow: 'inset 0 0 60px 20px rgba(0, 0, 0, 0.3)' }}
    />

    {isSelected && (
      <div
        className="absolute top-3 right-3 bg-primary text-primary-foreground rounded-full p-1"
        style={{ zIndex: Z_INDEX.CARD_HOVER }}
      >
        <Check className="w-4 h-4" />
      </div>
    )}

    <div
      className={`absolute bottom-3 left-3 flex items-center gap-2 ${isSelected ? 'text-white' : 'text-white'}`}
      style={{ zIndex: Z_INDEX.DROPDOWN }}
    >
      {genre.icon}
      <span className="font-bold text-lg drop-shadow">{genre.label}</span>
    </div>

    <div
      className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ${hovered === genre.value ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      style={{ zIndex: Z_INDEX.CARD_HOVER }}
    >
      <div className="ir-panel backdrop-blur-sm p-3 w-80 max-w-[90vw] max-h-[70vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-2">
          {genre.icon}
          <h3 className="text-lg font-bold text-foreground">{genre.label}</h3>
        </div>
        <p className="text-xs text-foreground mb-2 leading-snug">{genre.description}</p>
        <div className="mb-2">
          <h4 className="font-semibold text-foreground text-xs mb-1">Themes</h4>
          <div className="flex flex-wrap gap-1">
            {genre.themes.map((t) => (
              <Badge key={t} variant="secondary" className="text-xs py-0 px-1.5">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  </Card>
);
