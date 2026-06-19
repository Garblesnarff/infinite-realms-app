import React from 'react';

import { Card, CardContent } from '@/components/ui/card';

interface SpellcastingOverviewProps {
  spellAttackBonus: number;
  spellSaveDC: number;
  spellcastingAbility?: string;
}

const SpellcastingOverview: React.FC<SpellcastingOverviewProps> = ({
  spellAttackBonus,
  spellSaveDC,
  spellcastingAbility,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardContent className="p-4 text-center">
          <div className="text-2xl font-bold">+{spellAttackBonus}</div>
          <div className="text-sm text-muted-foreground">Spell Attack Bonus</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 text-center">
          <div className="text-2xl font-bold">{spellSaveDC}</div>
          <div className="text-sm text-muted-foreground">Spell Save DC</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 text-center">
          <div className="text-2xl font-bold capitalize">
            {spellcastingAbility?.substring(0, 3)}
          </div>
          <div className="text-sm text-muted-foreground">Spellcasting Ability</div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SpellcastingOverview;
