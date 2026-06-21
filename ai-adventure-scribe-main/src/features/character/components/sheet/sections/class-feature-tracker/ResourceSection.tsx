import { Zap } from 'lucide-react';
import React from 'react';

import type { CharacterResources } from '@/types/combat';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface ResourceSectionProps {
  characterResources: CharacterResources;
}

/**
 * ResourceSection displays character resources like hit dice, ki points, etc.
 */
export const ResourceSection: React.FC<ResourceSectionProps> = ({ characterResources }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-600" />
          Character Resources
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Hit Dice */}
        {characterResources.hitDice &&
          Object.entries(characterResources.hitDice).map(([dieType, dice]) => (
            <div key={dieType} className="border-l-4 border-yellow-500 pl-4">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="font-semibold">Hit Dice ({dieType})</h4>
                <Badge
                  variant={dice.current === 0 ? 'destructive' : 'outline'}
                  className="ml-auto"
                >
                  {dice.current} / {dice.max}
                </Badge>
              </div>
              <div className="mt-2">
                <div className="flex justify-between text-xs mb-1">
                  <span>Remaining</span>
                  <span>
                    {dice.current} / {dice.max}
                  </span>
                </div>
                <Progress
                  value={(dice.current / dice.max) * 100}
                  className="h-2"
                  aria-label={`Hit Dice (${dieType}) remaining`}
                />
              </div>
            </div>
          ))}

        {/* Class-Specific Resources */}
        {characterResources.rages !== undefined && (
          <div className="border-l-4 border-red-500 pl-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">Rages</h4>
              <Badge
                variant={characterResources.rages.current === 0 ? 'destructive' : 'outline'}
                className="ml-auto"
              >
                {characterResources.rages.current} / {characterResources.rages.max}
              </Badge>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span>Remaining</span>
                <span>
                  {characterResources.rages.current} / {characterResources.rages.max}
                </span>
              </div>
              <Progress
                value={(characterResources.rages.current / characterResources.rages.max) * 100}
                className="h-2"
                aria-label="Rages remaining"
              />
            </div>
          </div>
        )}

        {characterResources.kiPoints !== undefined && (
          <div className="border-l-4 border-purple-500 pl-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">Ki Points</h4>
              <Badge
                variant={characterResources.kiPoints.current === 0 ? 'destructive' : 'outline'}
                className="ml-auto"
              >
                {characterResources.kiPoints.current} / {characterResources.kiPoints.max}
              </Badge>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span>Remaining</span>
                <span>
                  {characterResources.kiPoints.current} / {characterResources.kiPoints.max}
                </span>
              </div>
              <Progress
                value={
                  (characterResources.kiPoints.current / characterResources.kiPoints.max) * 100
                }
                className="h-2"
                aria-label="Ki Points remaining"
              />
            </div>
          </div>
        )}

        {characterResources.sorceryPoints !== undefined && (
          <div className="border-l-4 border-green-500 pl-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">Sorcery Points</h4>
              <Badge
                variant={
                  characterResources.sorceryPoints.current === 0 ? 'destructive' : 'outline'
                }
                className="ml-auto"
              >
                {characterResources.sorceryPoints.current} /{' '}
                {characterResources.sorceryPoints.max}
              </Badge>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span>Remaining</span>
                <span>
                  {characterResources.sorceryPoints.current} /{' '}
                  {characterResources.sorceryPoints.max}
                </span>
              </div>
              <Progress
                value={
                  (characterResources.sorceryPoints.current /
                    characterResources.sorceryPoints.max) *
                  100
                }
                className="h-2"
                aria-label="Sorcery Points remaining"
              />
            </div>
          </div>
        )}

        {characterResources.bardic_inspiration !== undefined && (
          <div className="border-l-4 border-pink-500 pl-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">Bardic Inspiration</h4>
              <Badge
                variant={
                  characterResources.bardic_inspiration.current === 0
                    ? 'destructive'
                    : 'outline'
                }
                className="ml-auto"
              >
                {characterResources.bardic_inspiration.current} /{' '}
                {characterResources.bardic_inspiration.max}
              </Badge>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span>Remaining</span>
                <span>
                  {characterResources.bardic_inspiration.current} /{' '}
                  {characterResources.bardic_inspiration.max}
                </span>
              </div>
              <Progress
                value={
                  (characterResources.bardic_inspiration.current /
                    characterResources.bardic_inspiration.max) *
                  100
                }
                className="h-2"
                aria-label="Bardic Inspiration remaining"
              />
            </div>
          </div>
        )}

        {characterResources.channelDivinity !== undefined && (
          <div className="border-l-4 border-indigo-500 pl-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">Channel Divinity</h4>
              <Badge
                variant={
                  characterResources.channelDivinity.current === 0 ? 'destructive' : 'outline'
                }
                className="ml-auto"
              >
                {characterResources.channelDivinity.current} /{' '}
                {characterResources.channelDivinity.max}
              </Badge>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span>Remaining</span>
                <span>
                  {characterResources.channelDivinity.current} /{' '}
                  {characterResources.channelDivinity.max}
                </span>
              </div>
              <Progress
                value={
                  (characterResources.channelDivinity.current /
                    characterResources.channelDivinity.max) *
                  100
                }
                className="h-2"
                aria-label="Channel Divinity remaining"
              />
            </div>
          </div>
        )}

        {characterResources.layOnHands !== undefined && (
          <div className="border-l-4 border-orange-500 pl-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">Lay on Hands</h4>
              <Badge variant="outline" className="ml-auto">
                {characterResources.layOnHands.current} / {characterResources.layOnHands.max}{' '}
                points
              </Badge>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span>Remaining</span>
                <span>
                  {characterResources.layOnHands.current} / {characterResources.layOnHands.max}
                </span>
              </div>
              <Progress
                value={
                  (characterResources.layOnHands.current / characterResources.layOnHands.max) *
                  100
                }
                className="h-2"
                aria-label="Lay on Hands remaining"
              />
            </div>
          </div>
        )}

        {characterResources.actionSurge !== undefined && (
          <div className="border-l-4 border-cyan-500 pl-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">Action Surge</h4>
              <Badge
                variant={
                  characterResources.actionSurge.current === 0 ? 'destructive' : 'outline'
                }
                className="ml-auto"
              >
                {characterResources.actionSurge.current} / {characterResources.actionSurge.max}
              </Badge>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span>Remaining</span>
                <span>
                  {characterResources.actionSurge.current} /{' '}
                  {characterResources.actionSurge.max}
                </span>
              </div>
              <Progress
                value={
                  (characterResources.actionSurge.current /
                    characterResources.actionSurge.max) *
                  100
                }
                className="h-2"
                aria-label="Action Surge remaining"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
