import { Coins } from 'lucide-react';
import React from 'react';

import type { Currency } from '@/features/character/hooks/use-inventory-manager';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { convertCurrency } from '@/data/equipmentOptions';

interface CurrencySectionProps {
  currency: Currency;
  updateCurrency: (type: keyof Currency, amount: number) => void;
}

export const CurrencySection: React.FC<CurrencySectionProps> = ({ currency, updateCurrency }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-yellow-500" />
          Currency
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 gap-3">
          {Object.entries(currency).map(([type, amount]) => (
            <div key={type} className="text-center">
              <Label htmlFor={`currency-${type}`} className="text-xs uppercase">
                {type}
              </Label>
              <Input
                id={`currency-${type}`}
                type="number"
                min="0"
                value={amount}
                onChange={(e) => updateCurrency(type as keyof Currency, Number(e.target.value))}
                className="text-center"
              />
            </div>
          ))}
        </div>
        <div className="text-center mt-2 text-sm text-muted-foreground">
          Total Value:{' '}
          {convertCurrency(
            currency.cp +
              currency.sp * 10 +
              currency.ep * 50 +
              currency.gp * 100 +
              currency.pp * 1000,
            'cp',
            'gp',
          ).toFixed(2)}{' '}
          gp
        </div>
      </CardContent>
    </Card>
  );
};
