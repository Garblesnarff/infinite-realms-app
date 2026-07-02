import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DiceRollEmbed } from '@/features/game-session/components';

export function StandaloneDiceExamples() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Standalone Dice Components</CardTitle>
        <CardDescription>Individual dice components for different types of rolls</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <DiceRollEmbed
            expression="1d20"
            purpose="Basic d20 roll"
            autoRoll={false}
            showAnimation={true}
          />

          <DiceRollEmbed
            expression="2d6+3"
            purpose="Sword damage"
            autoRoll={false}
            showAnimation={true}
          />

          <DiceRollEmbed
            expression="1d20kh1"
            purpose="Advantage roll"
            autoRoll={false}
            showAnimation={true}
          />

          <DiceRollEmbed
            expression="4d6kh3"
            purpose="Ability score"
            autoRoll={false}
            showAnimation={true}
          />

          <DiceRollEmbed
            expression="1d100"
            purpose="Percentile roll"
            autoRoll={false}
            showAnimation={true}
          />
        </div>
      </CardContent>
    </Card>
  );
}
