import React, { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface StepNameDescriptionProps {
  name: string;
  description: string;
  onUpdate: (updates: { name?: string; description?: string }) => void;
}

export const StepNameDescription: React.FC<StepNameDescriptionProps> = ({
  name,
  description,
  onUpdate,
}) => {
  const nameId = useId();
  const descriptionId = useId();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor={nameId}>Scene Name *</Label>
        <Input
          id={nameId}
          placeholder="e.g., Goblin Cave Entrance"
          value={name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          maxLength={255}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={descriptionId}>Description (Optional)</Label>
        <Textarea
          id={descriptionId}
          placeholder="Describe the scene, important features, or notes for yourself..."
          value={description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          rows={6}
        />
      </div>
    </div>
  );
};
