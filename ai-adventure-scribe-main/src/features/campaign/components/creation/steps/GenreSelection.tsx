import { BookOpen, Grid, List, Eye, Sparkles } from 'lucide-react';
import React, { useId } from 'react';

import { CompactGenreCard, GridGenreCard, ListGenreCard } from './GenreCard';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useCampaign } from '@/contexts/CampaignContext';
import { GENRES } from '@/features/campaign/data/genres';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useToast } from '@/hooks/use-toast';

const GenreSelection: React.FC<{ isLoading?: boolean }> = ({ isLoading = false }) => {
  const { state, dispatch } = useCampaign();
  const { toast } = useToast();
  const { scrollToNavigation } = useAutoScroll();
  const genreHeaderId = useId();

  const [searchQuery, setSearchQuery] = React.useState('');
  const [viewMode, setViewMode] = React.useState<'grid' | 'list' | 'compact'>('compact');
  const [hovered, setHovered] = React.useState<string | null>(null);

  const filteredGenres = React.useMemo(() => {
    if (!searchQuery.trim()) return GENRES;
    const q = searchQuery.toLowerCase();
    return GENRES.filter(
      (g) =>
        g.label.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q) ||
        g.themes.some((t) => t.toLowerCase().includes(q)),
    );
  }, [searchQuery]);

  const handleGenreChange = (value: string) => {
    dispatch({
      type: 'UPDATE_CAMPAIGN',
      payload: { genre: value },
    });
    const selected = GENRES.find((g) => g.value === value);
    toast({
      title: 'Genre Selected',
      description: selected ? `You chose ${selected.label}.` : 'Selection updated.',
      duration: 1200,
    });
    scrollToNavigation();
  };

  if (isLoading) {
    return (
      <div className="space-y-8 parchment animate-fade-in-up">
        <div className="text-center mb-6">
          <Skeleton className="h-8 w-48 mx-auto mb-2" />
          <Skeleton className="h-4 w-64 mx-auto" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="choice-btn p-4">
              <Skeleton className="h-12 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 parchment animate-fade-in-up">
      <div className="text-center mb-6">
        <Label
          id={genreHeaderId}
          className="text-xl font-serif font-semibold flex items-center justify-center"
        >
          <BookOpen className="h-5 w-5 mr-2 text-blue-600" />
          Choose Your Campaign Genre
        </Label>
        <p className="text-sm text-muted-foreground mt-2">
          Select the world and tone for your epic adventure
        </p>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <Input
            placeholder="Search genres, themes, or descriptions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">View:</span>
          <div className="flex border rounded-md" role="group" aria-label="View mode">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('grid')}
              className="rounded-r-none"
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
              title="Grid view"
            >
              <Grid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="rounded-none border-x"
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              title="List view"
            >
              <List className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'compact' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('compact')}
              className="rounded-l-none"
              aria-label="Compact view"
              aria-pressed={viewMode === 'compact'}
              title="Compact view"
            >
              <Eye className="w-4 h-4" />
            </Button>
          </div>
          <div className="text-sm text-muted-foreground ml-auto">
            Showing {filteredGenres.length} of {GENRES.length}
          </div>
        </div>
      </div>

      <RadioGroup
        aria-labelledby={genreHeaderId}
        value={state.campaign?.genre || ''}
        onValueChange={handleGenreChange}
        className={
          viewMode === 'grid'
            ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
            : viewMode === 'list'
              ? 'space-y-4'
              : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
        }
      >
        {filteredGenres.map((genre) => {
          const isSelected = state.campaign?.genre === genre.value;
          if (viewMode === 'list') {
            return (
              <ListGenreCard
                key={genre.value}
                genre={genre}
                isSelected={isSelected}
                onGenreChange={handleGenreChange}
              />
            );
          }
          if (viewMode === 'compact') {
            return (
              <CompactGenreCard
                key={genre.value}
                genre={genre}
                isSelected={isSelected}
                onGenreChange={handleGenreChange}
              />
            );
          }
          return (
            <GridGenreCard
              key={genre.value}
              genre={genre}
              isSelected={isSelected}
              hovered={hovered}
              setHovered={setHovered}
              onGenreChange={handleGenreChange}
            />
          );
        })}
      </RadioGroup>
    </div>
  );
};

export default GenreSelection;
