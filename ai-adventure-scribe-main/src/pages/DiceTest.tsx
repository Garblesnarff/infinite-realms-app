import { useState } from 'react';

import { logger } from '../lib/logger';
import { type ChatMessage } from '../services/ai-service';
import { DiceTestFeatureInfo } from './dice-test/DiceTestFeatureInfo';
import { StandaloneDiceExamples } from './dice-test/StandaloneDiceExamples';
import { createInitialTestMessages } from './dice-test/testMessages';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DMChatBubble } from '@/features/game-session/components';

export default function DiceTest() {
  const [customExpression, setCustomExpression] = useState('1d20+5');
  const [testMessages, setTestMessages] = useState<ChatMessage[]>(createInitialTestMessages);

  const addTestMessage = () => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      content: `The DM asks you to make a test roll: [DICE: ${customExpression}] for your action.`,
      role: 'assistant',
      timestamp: Date.now(),
    };
    setTestMessages([...testMessages, newMessage]);
  };

  const addAdvantageMessage = () => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      content: `You have advantage on this roll! [DICE: 2d20kh1+5 attack with advantage] Strike with confidence!`,
      role: 'assistant',
      timestamp: Date.now(),
    };
    setTestMessages([...testMessages, newMessage]);
  };

  const addMultipleDiceMessage = () => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      content: `Critical hit! Roll damage: [DICE: 2d6+3 weapon damage] plus [DICE: 1d6 elemental damage]. The enemy staggers!`,
      role: 'assistant',
      timestamp: Date.now(),
    };
    setTestMessages([...testMessages, newMessage]);
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>🎲 Dice Rolling Integration Test</CardTitle>
          <CardDescription>
            Testing the new inline dice rolling system integrated into DM chat messages. Dice
            expressions use the format: [DICE: expression purpose]
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="flex flex-col gap-2">
              <Input
                placeholder="1d20+5"
                value={customExpression}
                onChange={(e) => setCustomExpression(e.target.value)}
              />
              <Button onClick={addTestMessage} size="sm">
                Add Custom Roll
              </Button>
            </div>
            <Button onClick={addAdvantageMessage} variant="outline" size="sm">
              Add Advantage Roll
            </Button>
            <Button onClick={addMultipleDiceMessage} variant="outline" size="sm">
              Add Multiple Dice
            </Button>
            <Button onClick={() => setTestMessages([])} variant="destructive" size="sm">
              Clear All
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DM Messages with Integrated Dice */}
        <Card>
          <CardHeader>
            <CardTitle>DM Chat Messages</CardTitle>
            <CardDescription>
              Messages with embedded dice expressions that auto-roll when displayed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {testMessages.map((message) => (
                <DMChatBubble
                  key={message.id}
                  message={message}
                  onOptionSelect={(option) => logger.info('Option selected:', option)}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Standalone Dice Examples */}
        <StandaloneDiceExamples />
      </div>

      {/* Feature Information */}
      <DiceTestFeatureInfo />
    </div>
  );
}
