import {
  Lightbulb,
  Heart,
  Brain,
  Anchor,
  Star,
  Plus,
  Trash2,
  Calendar,
  Sparkles,
  Target,
  AlertTriangle,
} from 'lucide-react';
import React, { useId } from 'react';

import type { Character } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { usePersonalityManager } from '@/features/character/hooks/use-personality-manager';

interface PersonalityManagerProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * PersonalityManager component for managing character personality and inspiration
 */
const PersonalityManager: React.FC<PersonalityManagerProps> = ({ character, onUpdate }) => {
  const awardInspirationId = useId();
  const traitId = useId();
  const idealId = useId();
  const bondId = useId();
  const flawId = useId();

  const {
    newTrait,
    setNewTrait,
    newIdeal,
    setNewIdeal,
    newBond,
    setNewBond,
    newFlaw,
    setNewFlaw,
    inspirationNotes,
    setInspirationNotes,
    personalityTraits,
    ideals,
    bonds,
    flaws,
    hasInspiration,
    inspirationHistory,
    toggleInspiration,
    awardInspiration,
    addPersonalityElement,
    removePersonalityElement,
  } = usePersonalityManager(character, onUpdate);

  /**
   * Get icon for personality element type
   */
  const getPersonalityIcon = (type: string): React.ElementType => {
    switch (type) {
      case 'trait':
        return Heart;
      case 'ideal':
        return Brain;
      case 'bond':
        return Anchor;
      case 'flaw':
        return AlertTriangle;
      default:
        return Heart;
    }
  };

  /**
   * Get color for personality element type
   */
  const getPersonalityColor = (type: string): string => {
    switch (type) {
      case 'trait':
        return 'text-red-500';
      case 'ideal':
        return 'text-blue-500';
      case 'bond':
        return 'text-green-500';
      case 'flaw':
        return 'text-orange-500';
      default:
        return 'text-gray-500';
    }
  };

  /**
   * Render personality element list
   */
  const renderPersonalityElements = (
    type: 'trait' | 'ideal' | 'bond' | 'flaw',
    items: string[],
    newValue: string,
    setNewValue: (value: string) => void,
    placeholder: string,
    textareaId: string,
  ): JSX.Element => {
    const Icon = getPersonalityIcon(type);
    const colorClass = getPersonalityColor(type);

    return (
      <Card>
        <CardHeader>
          <CardTitle className={`flex items-center gap-2 ${colorClass}`}>
            <Icon className="w-5 h-5" />
            {type.charAt(0).toUpperCase() + type.slice(1)}s
            <Badge variant="outline" className="ml-auto">
              {items.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                <div className="flex-1">
                  <p className="text-sm">{item}</p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removePersonalityElement(type, index)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      aria-label={`Remove ${type}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Remove {type}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}

            <div className="flex gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor={textareaId} className="sr-only">
                  Add new {type}
                </Label>
                <Textarea
                  id={textareaId}
                  placeholder={placeholder}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="w-full"
                  rows={2}
                  aria-label={`Add new ${type}`}
                />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    onClick={() => addPersonalityElement(type, newValue)}
                    disabled={!newValue.trim()}
                    className="mt-auto"
                    aria-label={`Add ${type}`}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add {type}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Inspiration System */}
      <Card className={`${hasInspiration ? 'border-gold-500 bg-gold-50 dark:bg-gold-950/20' : ''}`}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lightbulb
                className={`w-5 h-5 ${hasInspiration ? 'text-gold-500' : 'text-gray-500'}`}
              />
              Inspiration
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center">
                  <Switch
                    checked={hasInspiration}
                    onCheckedChange={toggleInspiration}
                    aria-label="Toggle inspiration"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle character inspiration</p>
              </TooltipContent>
            </Tooltip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div
                className={`w-16 h-16 rounded-full border-4 flex items-center justify-center ${
                  hasInspiration
                    ? 'border-gold-500 bg-gold-100 dark:bg-gold-900/50'
                    : 'border-gray-300 bg-gray-100 dark:bg-gray-800'
                }`}
              >
                <Star
                  className={`w-8 h-8 ${hasInspiration ? 'text-gold-500 animate-pulse' : 'text-gray-400'}`}
                />
              </div>
              <div className="flex-1">
                <h3 className="font-medium">
                  {hasInspiration ? 'You have inspiration!' : 'No inspiration'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {hasInspiration
                    ? 'You can use inspiration to gain advantage on one ability check, attack roll, or saving throw.'
                    : 'Inspiration is awarded for excellent roleplaying, particularly when acting on your personality traits, ideals, bonds, and flaws.'}
                </p>
              </div>
            </div>

            {/* Award Inspiration */}
            <div className="space-y-3 border-t pt-4">
              <Label htmlFor={awardInspirationId}>Award Inspiration</Label>
              <div className="flex gap-2">
                <Textarea
                  id={awardInspirationId}
                  placeholder="Reason for inspiration (e.g., 'Acted on bond to protect family')"
                  value={inspirationNotes}
                  onChange={(e) => setInspirationNotes(e.target.value)}
                  className="flex-1"
                  rows={2}
                />
                <div className="flex flex-col gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => awardInspiration(inspirationNotes, 'dm', inspirationNotes)}
                        disabled={!inspirationNotes.trim() || hasInspiration}
                      >
                        <Sparkles className="w-4 h-4 mr-1" />
                        Award
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Award inspiration to character</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>

            {/* Inspiration History */}
            {inspirationHistory.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <Label className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Inspiration History
                </Label>
                <div className="max-h-32 overflow-y-auto space-y-2">
                  {inspirationHistory
                    .slice(-5)
                    .reverse()
                    .map((entry, index) => (
                      <div key={index} className="text-xs p-2 bg-muted/50 rounded">
                        <div className="flex justify-between items-center">
                          <Badge variant="outline" className="text-xs">
                            {entry.source.toUpperCase()}
                          </Badge>
                          <span className="text-muted-foreground">
                            {new Date(entry.date).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="mt-1">{entry.description}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Personality Elements */}
      <Tabs defaultValue="traits" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="traits">Traits</TabsTrigger>
          <TabsTrigger value="ideals">Ideals</TabsTrigger>
          <TabsTrigger value="bonds">Bonds</TabsTrigger>
          <TabsTrigger value="flaws">Flaws</TabsTrigger>
        </TabsList>

        <TabsContent value="traits">
          {renderPersonalityElements(
            'trait',
            personalityTraits,
            newTrait,
            setNewTrait,
            "e.g., I idolize a particular hero of my faith and constantly refer to that person's deeds and example.",
            traitId,
          )}
        </TabsContent>

        <TabsContent value="ideals">
          {renderPersonalityElements(
            'ideal',
            ideals,
            newIdeal,
            setNewIdeal,
            'e.g., Tradition. The ancient traditions of worship and sacrifice must be preserved and upheld.',
            idealId,
          )}
        </TabsContent>

        <TabsContent value="bonds">
          {renderPersonalityElements(
            'bond',
            bonds,
            newBond,
            setNewBond,
            'e.g., I would die to recover an ancient relic of my faith that was lost long ago.',
            bondId,
          )}
        </TabsContent>

        <TabsContent value="flaws">
          {renderPersonalityElements(
            'flaw',
            flaws,
            newFlaw,
            setNewFlaw,
            'e.g., I judge others harshly, and myself even more severely.',
            flawId,
          )}
        </TabsContent>
      </Tabs>

      {/* Personality Integration Tips */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
            <Target className="w-5 h-5" />
            Roleplaying Tips
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-600 dark:text-blue-400">
          <div className="space-y-2">
            <p>
              <strong>Traits:</strong> Describe how your character behaves in everyday situations.
            </p>
            <p>
              <strong>Ideals:</strong> Drive your character's goals and ambitions - what they
              believe in.
            </p>
            <p>
              <strong>Bonds:</strong> Connect your character to the world - people, places, or
              things they care about.
            </p>
            <p>
              <strong>Flaws:</strong> Give your character weaknesses that can complicate their life
              in interesting ways.
            </p>
            <Separator className="my-3 bg-blue-300 dark:bg-blue-700" />
            <p>
              <em>
                Acting on these elements, especially when it creates interesting complications, is a
                great way to earn inspiration!
              </em>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PersonalityManager;
