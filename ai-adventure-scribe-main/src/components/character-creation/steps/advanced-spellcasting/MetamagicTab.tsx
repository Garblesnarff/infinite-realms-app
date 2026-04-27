import { Star } from 'lucide-react';
import React from 'react';

import type { MetamagicOption } from '@/data/spellcastingFeatures';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { TabsContent } from '@/components/ui/tabs';

interface MetamagicTabProps {
  selectedMetamagic: string[];
  maxMetamagicOptions: number;
  sorceryPoints: number;
  metamagicOptions: MetamagicOption[];
  handleMetamagicSelection: (id: string, checked: boolean) => void;
}

/**
 * Extracted MetamagicTab component for advanced spellcasting
 */
export const MetamagicTab: React.FC<MetamagicTabProps> = ({
  selectedMetamagic,
  maxMetamagicOptions,
  sorceryPoints,
  metamagicOptions,
  handleMetamagicSelection,
}) => (
  <TabsContent value="metamagic">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="w-5 h-5 text-gold-500" />
          Metamagic
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose {maxMetamagicOptions} metamagic options. You have {sorceryPoints} sorcery points to
          fuel them.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="text-center p-3 border rounded">
            <div className="text-2xl font-bold">{sorceryPoints}</div>
            <div className="text-xs text-muted-foreground">Sorcery Points</div>
          </div>
          <div className="text-center p-3 border rounded">
            <div className="text-2xl font-bold">{maxMetamagicOptions}</div>
            <div className="text-xs text-muted-foreground">Options Known</div>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Metamagic Options</span>
            <Badge variant="outline">
              {selectedMetamagic.length} / {maxMetamagicOptions}
            </Badge>
          </div>
          <div className="w-full bg-secondary rounded-full h-2 mt-2">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{
                width: `${(selectedMetamagic.length / maxMetamagicOptions) * 100}%`,
              }}
            />
          </div>
        </div>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {metamagicOptions.map((option) => (
            <div
              key={option.id}
              className={`p-4 border rounded-lg cursor-pointer transition-all ${
                selectedMetamagic.includes(option.id)
                  ? 'border-primary bg-primary/5'
                  : 'border-muted hover:border-primary/50'
              } ${
                !selectedMetamagic.includes(option.id) &&
                selectedMetamagic.length >= maxMetamagicOptions
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
              }`}
              onClick={() =>
                handleMetamagicSelection(option.id, !selectedMetamagic.includes(option.id))
              }
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium">{option.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {option.sorceryPointCost} SP
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                </div>
                <Checkbox
                  checked={selectedMetamagic.includes(option.id)}
                  disabled={
                    !selectedMetamagic.includes(option.id) &&
                    selectedMetamagic.length >= maxMetamagicOptions
                  }
                  onCheckedChange={(checked) =>
                    handleMetamagicSelection(option.id, checked === true)
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  </TabsContent>
);
