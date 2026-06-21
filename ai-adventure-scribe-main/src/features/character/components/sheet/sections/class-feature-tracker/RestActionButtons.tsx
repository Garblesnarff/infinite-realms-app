import { RotateCcw } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';

interface RestActionButtonsProps {
  onRest: (restType: 'short' | 'long') => void;
}

/**
 * RestActionButtons provides buttons for short and long rests
 */
export const RestActionButtons: React.FC<RestActionButtonsProps> = ({ onRest }) => {
  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => onRest('short')} className="flex-1">
        <RotateCcw className="w-4 h-4 mr-2" />
        Short Rest
      </Button>
      <Button variant="outline" onClick={() => onRest('long')} className="flex-1">
        <RotateCcw className="w-4 h-4 mr-2" />
        Long Rest
      </Button>
    </div>
  );
};
