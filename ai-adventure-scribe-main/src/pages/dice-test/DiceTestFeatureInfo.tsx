import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function DiceTestFeatureInfo() {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Features Implemented</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="font-semibold mb-2">✅ Core Features:</h4>
            <ul className="text-sm space-y-1 text-gray-700">
              <li>• Inline dice parsing from DM messages</li>
              <li>• 3D dice visualization with Three.js</li>
              <li>• Auto-rolling with animation</li>
              <li>• Manual roll button</li>
              <li>• Multiple dice types (d4, d6, d8, d10, d12, d20, d100)</li>
              <li>• Advantage/disadvantage support</li>
              <li>• Critical hit/miss detection</li>
              <li>• Audio effects (with fallback)</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-2">🎯 Dice Expression Format:</h4>
            <ul className="text-sm space-y-1 text-gray-700">
              <li>
                • <code>[DICE: 1d20+5]</code> - Basic roll with modifier
              </li>
              <li>
                • <code>[DICE: 1d20+5 attack]</code> - Roll with purpose
              </li>
              <li>
                • <code>[DICE: 2d20kh1+3 advantage]</code> - Advantage roll
              </li>
              <li>
                • <code>[DICE: 2d20kl1+3 disadvantage]</code> - Disadvantage roll
              </li>
              <li>
                • <code>[DICE: 2d6+3 damage]</code> - Damage roll
              </li>
              <li>
                • <code>[DICE: 4d6kh3 ability]</code> - Ability score generation
              </li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
