import React from 'react';

import { ColorPicker } from './ColorPicker';

interface MeasureOptionsProps {
  strokeColor: string;
  setStrokeColor: (color: string) => void;
}

export const MeasureOptions: React.FC<MeasureOptionsProps> = ({ strokeColor, setStrokeColor }) => {
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">Click and drag to measure distance.</div>
      <ColorPicker label="Line Color" value={strokeColor} onChange={setStrokeColor} />
    </div>
  );
};
