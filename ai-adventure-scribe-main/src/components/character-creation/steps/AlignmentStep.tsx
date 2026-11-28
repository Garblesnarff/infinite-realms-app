import { Scale } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCharacter } from '@/contexts/CharacterContext';

/**
 * The nine D&D alignments. #213 QA-051: the wizard had no alignment step, so
 * alignment saved as '' and the sheet displayed "Unaligned".
 */
export const ALIGNMENTS = [
  {
    id: 'Lawful Good',
    description: 'Acts with compassion and honor, and follows just laws.',
  },
  {
    id: 'Neutral Good',
    description: 'Does good without bias for or against order.',
  },
  {
    id: 'Chaotic Good',
    description: 'Acts as conscience directs, with little regard for rules.',
  },
  {
    id: 'Lawful Neutral',
    description: 'Follows law, tradition, and order above all.',
  },
  {
    id: 'True Neutral',
    description: 'Keeps the balance, avoiding extremes.',
  },
  {
    id: 'Chaotic Neutral',
    description: 'Follows whims, valuing personal freedom above all.',
  },
  {
    id: 'Lawful Evil',
    description: 'Takes what they want within a code or hierarchy.',
  },
  {
    id: 'Neutral Evil',
    description: 'Does whatever serves them, without compassion or principle.',
  },
  {
    id: 'Chaotic Evil',
    description: 'Acts with arbitrary violence, driven by greed and hatred.',
  },
] as const;

const AlignmentStep: React.FC = () => {
  const { state, dispatch } = useCharacter();
  const character = state.character!;
  const selected = character.alignment || '';

  const handleAlignmentChange = (alignment: string): void => {
    dispatch({ type: 'UPDATE_CHARACTER', payload: { alignment } });
  };

  const handleClear = (): void => {
    dispatch({ type: 'UPDATE_CHARACTER', payload: { alignment: '' } });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center space-x-3">
          <div className="p-3 bg-gradient-to-br from-infinite-purple to-infinite-teal rounded-full shadow-lg">
            <Scale className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-infinite-purple to-infinite-teal bg-clip-text text-transparent">
              Alignment
            </h2>
            <p className="text-muted-foreground">
              Choose your character&apos;s moral outlook — or leave it unset
            </p>
          </div>
        </div>
        {selected && (
          <Badge variant="outline" className="text-sm">
            {selected}
          </Badge>
        )}
      </div>

      <Card className="glass rounded-2xl hover-lift border-2 border-infinite-purple/20 transition-all">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-infinite-purple" />
            Alignment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={selected}
            onValueChange={handleAlignmentChange}
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
            aria-label="Alignment"
          >
            {ALIGNMENTS.map((alignment) => {
              const slug = alignment.id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              return (
                <div
                  key={alignment.id}
                  className="flex items-start space-x-2 rounded-lg border p-3"
                >
                  <RadioGroupItem value={alignment.id} id={`alignment-${slug}`} />
                  <Label htmlFor={`alignment-${slug}`} className="cursor-pointer space-y-1">
                    <span className="block font-medium">{alignment.id}</span>
                    <span className="block text-xs text-muted-foreground">
                      {alignment.description}
                    </span>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
          {selected && (
            <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
              Clear selection
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AlignmentStep;
