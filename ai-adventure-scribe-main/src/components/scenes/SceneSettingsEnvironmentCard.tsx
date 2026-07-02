import { Sun, Moon, Cloud } from 'lucide-react';
import React, { useId } from 'react';

import type { SceneSettingsData, UpdateSceneSetting } from './scene-settings-types';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';

interface SceneSettingsEnvironmentCardProps {
  settings: SceneSettingsData;
  onUpdate: UpdateSceneSetting;
}

export const SceneSettingsEnvironmentCard: React.FC<SceneSettingsEnvironmentCardProps> = ({
  settings,
  onUpdate,
}) => {
  const timeOfDayId = useId();
  const timeDawnId = useId();
  const timeDayId = useId();
  const timeDuskId = useId();
  const timeNightId = useId();
  const weatherId = useId();

  return (
    <Card variant="parchment">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" />
          Environment
        </CardTitle>
        <CardDescription>Set time of day and weather conditions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Label id={timeOfDayId}>Time of Day</Label>
          <RadioGroup
            value={settings.timeOfDay || 'day'}
            onValueChange={(value) => onUpdate('timeOfDay', value)}
            aria-labelledby={timeOfDayId}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="dawn" id={timeDawnId} />
                <Label
                  htmlFor={timeDawnId}
                  className="flex-1 cursor-pointer flex items-center gap-2"
                >
                  <Sun className="h-4 w-4 text-orange-400" />
                  Dawn
                </Label>
              </div>

              <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="day" id={timeDayId} />
                <Label
                  htmlFor={timeDayId}
                  className="flex-1 cursor-pointer flex items-center gap-2"
                >
                  <Sun className="h-4 w-4 text-yellow-400" />
                  Day
                </Label>
              </div>

              <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="dusk" id={timeDuskId} />
                <Label
                  htmlFor={timeDuskId}
                  className="flex-1 cursor-pointer flex items-center gap-2"
                >
                  <Sun className="h-4 w-4 text-orange-600" />
                  Dusk
                </Label>
              </div>

              <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem value="night" id={timeNightId} />
                <Label
                  htmlFor={timeNightId}
                  className="flex-1 cursor-pointer flex items-center gap-2"
                >
                  <Moon className="h-4 w-4 text-blue-300" />
                  Night
                </Label>
              </div>
            </div>
          </RadioGroup>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor={weatherId}>Weather Effects</Label>
          <Input
            id={weatherId}
            placeholder="e.g., Heavy rain, Light snow, Fog"
            value={settings.weatherEffects || ''}
            onChange={(e) => onUpdate('weatherEffects', e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Descriptive weather conditions for narrative purposes
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
