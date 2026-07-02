import { Check } from 'lucide-react';
import React from 'react';

import { type GenreCardProps } from './ListGenreCard';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { Z_INDEX } from '@/constants/z-index';

export const CompactGenreCard: React.FC<GenreCardProps> = ({
  genre,
  isSelected,
  onGenreChange,
}) => (
  <Card
    key={genre.value}
    className={`cursor-pointer transition-all hover:shadow-lg border-2 relative p-4 overflow-hidden ${
      isSelected ? 'border-primary bg-primary/5 shadow-lg' : 'border-border hover:border-primary/50'
    }`}
    onClick={() => onGenreChange(genre.value)}
    role="radio"
    aria-checked={isSelected}
    aria-label={`${genre.label}: ${genre.description}`}
    title={genre.label}
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') onGenreChange(genre.value);
    }}
    style={
      genre.backgroundImage
        ? {
            backgroundImage: `url(${genre.backgroundImage}), url('/campaign-background-placeholder.png')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }
        : undefined
    }
  >
    {genre.backgroundImage && (
      <div className="absolute inset-0 bg-black/70" style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }} />
    )}
    <div
      className={`flex items-center justify-between mb-2 relative ${genre.backgroundImage ? 'text-white' : ''}`}
      style={{ zIndex: Z_INDEX.DROPDOWN }}
    >
      <div className="flex items-center gap-2">
        <RadioGroupItem
          value={genre.value}
          id={genre.value}
          className="text-blue-600"
          tabIndex={-1}
          aria-hidden="true"
        />
        <div className={`flex items-center ${genre.colorClass}`}>
          {genre.icon}
          <Label htmlFor={genre.value} className="font-medium cursor-pointer leading-tight ml-2">
            {genre.label}
          </Label>
        </div>
      </div>
      {isSelected && (
        <div className="bg-primary text-primary-foreground rounded-full p-1">
          <Check className="w-3 h-3" />
        </div>
      )}
    </div>
    <div className="flex flex-wrap gap-1 mb-1 relative" style={{ zIndex: Z_INDEX.DROPDOWN }}>
      {genre.themes.map((t) => (
        <Badge
          key={t}
          variant="secondary"
          className={`text-xs ${genre.backgroundImage ? 'bg-black/60 text-white border-white/20 backdrop-blur-sm' : ''}`}
        >
          {t}
        </Badge>
      ))}
    </div>
    <p
      className={`text-xs line-clamp-2 relative ${genre.backgroundImage ? 'text-gray-200' : 'text-muted-foreground'}`}
      style={{ zIndex: Z_INDEX.DROPDOWN }}
    >
      {genre.description}
    </p>
  </Card>
);
