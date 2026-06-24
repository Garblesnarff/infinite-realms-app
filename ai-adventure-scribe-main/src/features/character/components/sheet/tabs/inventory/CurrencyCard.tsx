import { Coins } from 'lucide-react';
import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface Currency {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

interface CurrencyCardProps {
  currency: Currency;
}

/**
 * Displays the character's currency and total gold value
 */
export const CurrencyCard: React.FC<CurrencyCardProps> = ({ currency }) => {
  // Convert currency to total value in gold pieces
  const totalValueInGold = (
    currency.pp * 10 +
    currency.gp +
    currency.ep * 0.5 +
    currency.sp * 0.1 +
    currency.cp * 0.01
  ).toFixed(2);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-yellow-500" />
          Currency
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="grid grid-cols-5 gap-2 text-center">
            <div>
              <div className="text-lg font-bold text-orange-600">{currency.pp}</div>
              <div className="text-xs">PP</div>
            </div>
            <div>
              <div className="text-lg font-bold text-yellow-600">{currency.gp}</div>
              <div className="text-xs">GP</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gray-600">{currency.ep}</div>
              <div className="text-xs">EP</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gray-400">{currency.sp}</div>
              <div className="text-xs">SP</div>
            </div>
            <div>
              <div className="text-lg font-bold text-orange-800">{currency.cp}</div>
              <div className="text-xs">CP</div>
            </div>
          </div>
          <div className="text-center pt-2 border-t">
            <div className="text-sm text-muted-foreground">
              Total Value: {totalValueInGold} gp
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
