import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const FeaturesProficienciesCard: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Proficiencies</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium mb-2">Armor</h4>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">Light Armor</Badge>
              <Badge variant="outline">Medium Armor</Badge>
              <Badge variant="outline">Heavy Armor</Badge>
              <Badge variant="outline">Shields</Badge>
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-2">Weapons</h4>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">Simple Weapons</Badge>
              <Badge variant="outline">Martial Weapons</Badge>
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-2">Languages</h4>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">Common</Badge>
              <Badge variant="outline">Elvish</Badge>
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-2">Tools</h4>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">Smith's Tools</Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
