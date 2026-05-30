import { Users, Eye, Edit, Crown, ArrowRight, UserMinus } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import type { PermissionLevel } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * SharedCharacter Interface
 */
export interface SharedCharacter {
  id: string;
  name: string;
  description?: string;
  race?: string;
  class?: string;
  level?: number;
  avatarUrl?: string;
  backgroundImage?: string;
  ownerId: string;
  ownerName?: string;
  ownerEmail?: string;
  permissionLevel: PermissionLevel;
  sharedAt: string;
}

/**
 * Permission level badge with icon
 */
export const PermissionBadge: React.FC<{ level: PermissionLevel }> = ({ level }) => {
  const config = {
    viewer: {
      icon: Eye,
      label: 'Viewer',
      variant: 'secondary' as const,
      description: 'Can view only',
    },
    editor: {
      icon: Edit,
      label: 'Editor',
      variant: 'purple' as const,
      description: 'Can edit',
    },
    owner: {
      icon: Crown,
      label: 'Co-Owner',
      variant: 'gold' as const,
      description: 'Full access',
    },
  };

  const { icon: Icon, label, variant, description } = config[level];

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Badge
          variant={variant}
          className="gap-1 cursor-help focus-visible:ring-2 focus-visible:ring-infinite-purple outline-none"
          tabIndex={0}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
};

/**
 * Individual shared character card
 */
export const SharedCharacterCard: React.FC<{
  character: SharedCharacter;
  onRemoveSelf: (characterId: string, characterName: string) => void;
}> = ({ character, onRemoveSelf }) => {
  const navigate = useNavigate();

  return (
    <Card className="group relative border-2 border-border/30 shadow-md transition-all duration-300 hover:shadow-xl hover:border-infinite-purple/50">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-10 rounded-lg"
        aria-hidden="true"
        style={
          character.backgroundImage
            ? { backgroundImage: `url(${character.backgroundImage})` }
            : undefined
        }
      />

      <div className="relative p-4 space-y-3">
        {/* Header with Avatar */}
        <div className="flex items-start gap-3">
          {character.avatarUrl && (
            <img
              src={character.avatarUrl}
              alt={character.name}
              className="w-12 h-12 rounded-full object-cover border-2 border-infinite-gold/50"
            />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate" title={character.name}>{character.name}</h3>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {character.race && <span>{character.race}</span>}
              {character.class && (
                <>
                  <span>•</span>
                  <span>{character.class}</span>
                </>
              )}
              {character.level && (
                <>
                  <span>•</span>
                  <span>Level {character.level}</span>
                </>
              )}
            </div>
          </div>
          <PermissionBadge level={character.permissionLevel} />
        </div>

        {/* Description */}
        {character.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{character.description}</p>
        )}

        {/* Owner Info */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" aria-hidden="true" />
          <span>
            Shared by{' '}
            <span className="font-medium text-foreground">
              {character.ownerName || character.ownerEmail || 'Unknown'}
            </span>
          </span>
        </div>

        {/* Shared Date */}
        <div className="text-xs text-muted-foreground">
          Shared {new Date(character.sharedAt).toLocaleDateString()}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                onClick={() => navigate(`/app/character/${character.id}`)}
                className="flex-1"
                aria-label={`View ${character.name}'s character sheet`}
              >
                View Character
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>View {character.name}'s character sheet</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemoveSelf(character.id, character.name)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove my access to ${character.name}`}
              >
                <UserMinus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Remove my access to {character.name}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </Card>
  );
};
