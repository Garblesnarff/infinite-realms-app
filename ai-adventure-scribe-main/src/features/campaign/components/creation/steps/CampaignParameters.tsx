import { Gauge, Clock, Theater, Zap, Skull, Grid, List, Eye, Sparkles } from 'lucide-react';
import React from 'react';

import CampaignParameterSection, { type ParameterOption } from './CampaignParameterSection';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { useCampaign } from '@/contexts/CampaignContext';

/**
 * Predefined options for campaign parameters
 */
const difficultyLevels: ParameterOption[] = [
  { value: 'easy', label: 'Easy', colorClass: 'text-green-600' },
  { value: 'medium', label: 'Medium', colorClass: 'text-amber-600' },
  { value: 'hard', label: 'Hard', colorClass: 'text-destructive' },
];

const campaignLengths: ParameterOption[] = [
  { value: 'one-shot', label: 'One-Shot Adventure', colorClass: 'text-blue-600' },
  { value: 'short', label: 'Short Campaign', colorClass: 'text-purple-600' },
  { value: 'full', label: 'Full Campaign', colorClass: 'text-infinite-purple' },
];

const tones: ParameterOption[] = [
  {
    value: 'serious',
    label: 'Serious',
    colorClass: 'text-gray-700',
    icon: <Theater className="h-5 w-5" />,
  },
  {
    value: 'humorous',
    label: 'Humorous',
    colorClass: 'text-yellow-600',
    icon: <Zap className="h-5 w-5" />,
  },
  {
    value: 'gritty',
    label: 'Gritty',
    colorClass: 'text-destructive',
    icon: <Skull className="h-5 w-5" />,
  },
];

/**
 * Campaign parameters selection component
 * Handles difficulty, length, and tone selection with loading states
 */
const CampaignParameters: React.FC<{ isLoading?: boolean }> = ({ isLoading = false }) => {
  const { state, dispatch } = useCampaign();
  const { toast } = useToast();

  const [viewMode, setViewMode] = React.useState<'grid' | 'list' | 'compact'>('compact');
  const [searchQuery, setSearchQuery] = React.useState('');

  /**
   * Handles parameter value changes
   * @param field - Parameter field name
   * @param value - Selected parameter value
   */
  const handleParameterChange = (field: string, value: string): void => {
    dispatch({ type: 'UPDATE_CAMPAIGN', payload: { [field]: value } });
    const label =
      field === 'difficulty_level'
        ? difficultyLevels.find((d) => d.value === value)?.label
        : field === 'campaign_length'
          ? campaignLengths.find((d) => d.value === value)?.label
          : tones.find((d) => d.value === value)?.label;
    toast({ title: 'Selection updated', description: label || value, duration: 1000 });
  };

  if (isLoading) {
    return (
      <div className="space-y-8 parchment animate-fade-in-up">
        {[1, 2, 3].map((section) => (
          <div key={section}>
            <div className="text-center mb-4">
              <Skeleton className="h-8 w-48 mx-auto mb-2" />
              <Skeleton className="h-4 w-64 mx-auto" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="choice-btn p-4">
                  <Skeleton className="h-12 w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const matchesSearch = (label: string): boolean =>
    !searchQuery.trim() || label.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <div className="space-y-10 parchment animate-fade-in-up">
      {/* Controls */}
      <div className="space-y-4">
        <div className="relative">
          <Input
            placeholder="Search difficulty, length, or tone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            aria-label="Search parameters"
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
        </div>
      </div>

      <CampaignParameterSection
        id="difficulty"
        title="Difficulty Level"
        description="Choose the challenge level for your adventurers"
        icon={Gauge}
        options={difficultyLevels}
        selectedValue={state.campaign?.difficulty_level || ''}
        onValueChange={(val) => handleParameterChange('difficulty_level', val)}
        viewMode={viewMode}
        matchesSearch={matchesSearch}
      />

      <CampaignParameterSection
        id="length"
        title="Campaign Length"
        description="How long will your epic story unfold?"
        icon={Clock}
        options={campaignLengths}
        selectedValue={state.campaign?.campaign_length || ''}
        onValueChange={(val) => handleParameterChange('campaign_length', val)}
        viewMode={viewMode}
        matchesSearch={matchesSearch}
      />

      <CampaignParameterSection
        id="tone"
        title="Campaign Tone"
        description="What mood will define your adventure?"
        icon={Theater}
        options={tones}
        selectedValue={state.campaign?.tone || ''}
        onValueChange={(val) => handleParameterChange('tone', val)}
        viewMode={viewMode}
        matchesSearch={matchesSearch}
      />
    </div>
  );
};

export default CampaignParameters;
