import { Check, User, Shield, Sword, Star, X } from 'lucide-react';
import React, { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface CharacterPreview {
  version: string;
  character: {
    name: string;
    description?: string;
    race?: string;
    class?: string;
    level?: number;
    alignment?: string;
    background?: string;
    [key: string]: unknown;
  };
  stats?: {
    strength?: number;
    dexterity?: number;
    constitution?: number;
    intelligence?: number;
    wisdom?: number;
    charisma?: number;
  };
  exportedAt?: string;
}

interface ImportCharacterPreviewProps {
  characterData: CharacterPreview;
  importName: string;
  onImportNameChange: (name: string) => void;
  onClear: () => void;
  nameInputId: string;
}

export const ImportCharacterPreview: React.FC<ImportCharacterPreviewProps> = ({
  characterData,
  importName,
  onImportNameChange,
  onClear,
  nameInputId,
}) => {
  const nameDescriptionId = useId();

  return (
    <div className="space-y-4">
      {/* Success indicator */}
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-3 p-4 bg-infinite-teal/10 border border-infinite-teal/30 rounded-lg"
      >
        <Check className="h-5 w-5 text-infinite-teal flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <div className="font-semibold text-sm">File Validated</div>
          <div className="text-sm text-muted-foreground mt-1">
            Character data is valid and ready to import
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClear}
              className="h-6 w-6"
              aria-label="Remove selected file"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Remove selected file</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Character Info */}
      <div className="border rounded-lg p-4 bg-accent/20">
        <h4 className="font-semibold mb-3 flex items-center gap-2">
          <User className="h-4 w-4" aria-hidden="true" />
          Character Preview
        </h4>

        <div className="space-y-3">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground mb-1">Name</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="font-medium truncate outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm cursor-help"
                    tabIndex={0}
                  >
                    {characterData.character.name}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{characterData.character.name}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            {characterData.character.race && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Race</div>
                <div className="flex items-center gap-1">
                  <Shield className="h-3 w-3 text-infinite-purple" aria-hidden="true" />
                  {characterData.character.race}
                </div>
              </div>
            )}
            {characterData.character.class && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Class</div>
                <div className="flex items-center gap-1">
                  <Sword className="h-3 w-3 text-infinite-gold" aria-hidden="true" />
                  {characterData.character.class}
                </div>
              </div>
            )}
            {characterData.character.level && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Level</div>
                <div className="flex items-center gap-1">
                  <Star className="h-3 w-3 text-infinite-teal" aria-hidden="true" />
                  {characterData.character.level}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          {characterData.character.description && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Description</div>
              <div className="text-sm line-clamp-2">{characterData.character.description}</div>
            </div>
          )}

          {/* Stats Preview */}
          {characterData.stats && (
            <div>
              <div className="text-xs text-muted-foreground mb-2">Ability Scores</div>
              <div className="grid grid-cols-6 gap-2" role="group" aria-label="Ability Scores">
                {Object.entries(characterData.stats).map(([stat, value]) => (
                  <div
                    key={stat}
                    className="text-center p-2 bg-background rounded border"
                    aria-label={`${stat}: ${value || 10}`}
                  >
                    <div className="text-xs font-medium uppercase" aria-hidden="true">
                      {stat.slice(0, 3)}
                    </div>
                    <span className="sr-only">{stat}</span>
                    <div className="text-sm font-bold">{value || 10}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Export info */}
          {characterData.exportedAt && (
            <div className="text-xs text-muted-foreground">
              Exported: {new Date(characterData.exportedAt).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {/* Rename Option */}
      <div className="space-y-2">
        <Label htmlFor={nameInputId}>Character Name (Optional Rename)</Label>
        <Input
          id={nameInputId}
          placeholder={characterData.character.name}
          value={importName}
          onChange={(e) => onImportNameChange(e.target.value)}
          aria-describedby={nameDescriptionId}
        />
        <p id={nameDescriptionId} className="text-xs text-muted-foreground">
          Leave empty to keep the original name
        </p>
      </div>
    </div>
  );
};
