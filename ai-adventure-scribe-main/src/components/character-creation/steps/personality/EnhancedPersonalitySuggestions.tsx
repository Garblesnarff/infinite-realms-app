import { Heart, Brain, Anchor, AlertTriangle, Lightbulb, Copy } from 'lucide-react';
import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface BackgroundSuggestions {
  traits: string[];
  ideals: string[];
  bonds: string[];
  flaws: string[];
}

interface EnhancedPersonalitySuggestionsProps {
  suggestions: BackgroundSuggestions | null;
  onApplySuggestion: (
    type: 'traits' | 'ideals' | 'bonds' | 'flaws',
    suggestion: string,
    index?: number,
  ) => void;
}

/**
 * Component to display background-based personality suggestions
 */
export const EnhancedPersonalitySuggestions: React.FC<EnhancedPersonalitySuggestionsProps> = ({
  suggestions,
  onApplySuggestion,
}) => {
  /**
   * Render suggestion card
   */
  const renderSuggestions = (
    type: 'traits' | 'ideals' | 'bonds' | 'flaws',
    title: string,
    suggestionList: string[],
    icon: React.ElementType,
    colorClass: string,
  ) => {
    if (!suggestionList || suggestionList.length === 0) {
      return null;
    }

    return (
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className={`flex items-center gap-2 text-sm ${colorClass}`}>
            {React.createElement(icon, { className: 'w-4 h-4' })}
            {title} Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {suggestionList.slice(0, 3).map((suggestion, index) => (
              <div
                key={index}
                className="p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors group"
                onClick={() =>
                  onApplySuggestion(type, suggestion, type === 'traits' ? 0 : undefined)
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs flex-1">{suggestion}</p>
                  <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Lightbulb className="w-5 h-5 text-yellow-500" />
        Background Suggestions
      </h3>

      {suggestions ? (
        <div className="space-y-4">
          {renderSuggestions(
            'traits',
            'Personality Trait',
            suggestions.traits,
            Heart,
            'text-red-500',
          )}
          {renderSuggestions('ideals', 'Ideal', suggestions.ideals, Brain, 'text-blue-500')}
          {renderSuggestions('bonds', 'Bond', suggestions.bonds, Anchor, 'text-green-500')}
          {renderSuggestions(
            'flaws',
            'Flaw',
            suggestions.flaws,
            AlertTriangle,
            'text-orange-500',
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No suggestions available for this background.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
