import { Volume2, Hand, Package, Zap, BookOpen, Clock } from 'lucide-react';
import React from 'react';

import type { Spell } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface SpellCastingDetailsProps {
  selectedSpell: Spell;
  selectedSpellLevel?: number;
}

function getComponentIcon(componentType: 'verbal' | 'somatic' | 'material'): React.ReactNode {
  switch (componentType) {
    case 'verbal':
      return <Volume2 className="w-4 h-4" />;
    case 'somatic':
      return <Hand className="w-4 h-4" />;
    case 'material':
      return <Package className="w-4 h-4" />;
    default:
      return null;
  }
}

export const SpellCastingDetails: React.FC<SpellCastingDetailsProps> = ({
  selectedSpell,
  selectedSpellLevel,
}) => {
  return (
    <div className="space-y-4">
      {/* Spell Info */}
      <div className="p-3 bg-muted rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-lg">{selectedSpell.name}</h3>
          <Badge variant="outline">Level {selectedSpell.level}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {selectedSpell.school} • {selectedSpell.casting_time} • {selectedSpell.range}
        </p>
        {selectedSpellLevel && selectedSpellLevel !== selectedSpell.level && (
          <Badge variant="secondary" className="mt-2">
            Cast at Level {selectedSpellLevel}
          </Badge>
        )}
      </div>

      <Separator />

      {/* Component Requirements */}
      <div>
        <h4 className="font-semibold mb-2 flex items-center gap-2">
          <BookOpen className="w-4 h-4" />
          Components Required
        </h4>

        <div className="space-y-3">
          {/* Verbal Component */}
          {selectedSpell.components_verbal !== undefined && (
            <div className="flex items-center justify-between p-2 border rounded">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-blue-100 rounded">{getComponentIcon('verbal')}</div>
                <span>Verbal (V)</span>
              </div>
              <Badge variant={selectedSpell.components_verbal ? 'default' : 'secondary'}>
                {selectedSpell.components_verbal ? 'Required' : 'Not Required'}
              </Badge>
            </div>
          )}

          {/* Somatic Component */}
          {selectedSpell.components_somatic !== undefined && (
            <div className="flex items-center justify-between p-2 border rounded">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-green-100 rounded">{getComponentIcon('somatic')}</div>
                <span>Somatic (S)</span>
              </div>
              <Badge variant={selectedSpell.components_somatic ? 'default' : 'secondary'}>
                {selectedSpell.components_somatic ? 'Required' : 'Not Required'}
              </Badge>
            </div>
          )}

          {/* Material Component */}
          {selectedSpell.components_material !== undefined && (
            <div className="p-2 border rounded">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-purple-100 rounded">{getComponentIcon('material')}</div>
                  <span>Material (M)</span>
                </div>
                <Badge variant={selectedSpell.components_material ? 'default' : 'secondary'}>
                  {selectedSpell.components_material ? 'Required' : 'Not Required'}
                </Badge>
              </div>

              {selectedSpell.components_material && selectedSpell.material_components && (
                <div className="mt-2 p-2 bg-muted rounded text-sm">
                  <p className="font-medium mb-1">Material Required:</p>
                  <p>{selectedSpell.material_components}</p>
                  {selectedSpell.material_cost && (
                    <p className="mt-1 text-xs">
                      Cost: {selectedSpell.material_cost} gp
                      {selectedSpell.material_consumed && ' (consumed)'}
                    </p>
                  )}
                  {selectedSpell.material_consumed && (
                    <p className="mt-1 text-xs text-red-500 font-medium">
                      ⚠️ This component is consumed when cast
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Spell Description */}
      <div>
        <h4 className="font-semibold mb-2 flex items-center gap-2">
          <BookOpen className="w-4 h-4" />
          Description
        </h4>
        <p className="text-sm">{selectedSpell.description}</p>
      </div>

      {selectedSpell.damage && (
        <>
          <Separator />
          <div>
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Damage
            </h4>
            <p className="text-sm font-mono">{selectedSpell.damage}</p>
          </div>
        </>
      )}

      {(selectedSpell.ritual || selectedSpell.concentration) && (
        <>
          <Separator />
          <div className="flex flex-wrap gap-2">
            {selectedSpell.ritual && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Ritual
              </Badge>
            )}
            {selectedSpell.concentration && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                Concentration
              </Badge>
            )}
          </div>
        </>
      )}
    </div>
  );
};
