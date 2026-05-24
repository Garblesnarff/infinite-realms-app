import { Check } from 'lucide-react';
import React from 'react';

import type { GenreMeta } from '@/features/campaign/data/genres';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { Z_INDEX } from '@/constants/z-index';

interface GenreCardProps {
  genre: GenreMeta;
  isSelected: boolean;
  onGenreChange: (value: string) => void;
}

export const ListGenreCard: React.FC<GenreCardProps> = ({ genre, isSelected, onGenreChange }) => (
  <Card
    className={`cursor-pointer transition-all hover:shadow-lg border-2 relative overflow-hidden ${
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
      <div
        className="absolute inset-0 bg-black/70"
        style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
      />
    )}
    <div
      className={`p-4 relative ${genre.backgroundImage ? 'text-white' : ''}`}
      style={{ zIndex: Z_INDEX.DROPDOWN }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
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
            <Check className="w-4 h-4" />
          </div>
        )}
      </div>
      <p
        className={`text-sm mt-2 line-clamp-2 ${genre.backgroundImage ? 'text-gray-200' : 'text-muted-foreground'}`}
      >
        {genre.description}
      </p>
      <div className={`flex flex-wrap gap-1 mt-2 ${genre.backgroundImage ? 'text-gray-300' : ''}`}>
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
    </div>
  </Card>
);

export const CompactGenreCard: React.FC<GenreCardProps> = ({ genre, isSelected, onGenreChange }) => (
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
      <div
        className="absolute inset-0 bg-black/70"
        style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
      />
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
      <div className="bg-white/95 backdrop-blur-sm p-3 rounded-lg shadow-xl border border-border w-80 max-w-[90vw] max-h-[70vh] overflow-y-auto">
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
