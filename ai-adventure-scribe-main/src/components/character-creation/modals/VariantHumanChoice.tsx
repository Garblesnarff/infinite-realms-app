import { Zap, Award } from 'lucide-react';
import React, { useState } from 'react';

import { VariantHumanAbilityTab } from './VariantHumanAbilityTab';
import { VariantHumanFeatTab } from './VariantHumanFeatTab';

import type { AbilityScoreName } from '@/utils/racialAbilityBonuses';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface VariantHumanChoiceProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (abilities: [AbilityScoreName, AbilityScoreName], feat: string) => void;
  currentChoices?: {
    abilities?: [AbilityScoreName, AbilityScoreName];
    feat?: string;
  };
}

/**
 * Modal for Variant Human players to choose two abilities and one feat
 * Per D&D 5E: Variant Humans get +1 to two different abilities and one feat
 */
export const VariantHumanChoice: React.FC<VariantHumanChoiceProps> = ({
  isOpen,
  onClose,
  onConfirm,
  currentChoices,
}) => {
  const [selectedAbilities, setSelectedAbilities] = useState<AbilityScoreName[]>(
    currentChoices?.abilities ? [...currentChoices.abilities] : [],
  );
  const [selectedFeat, setSelectedFeat] = useState<string | null>(currentChoices?.feat || null);
  const [featCategory, setFeatCategory] = useState('all');

  const toggleAbility = (ability: AbilityScoreName) => {
    if (selectedAbilities.includes(ability)) {
      // Deselect
      setSelectedAbilities(selectedAbilities.filter((a) => a !== ability));
    } else if (selectedAbilities.length < 2) {
      // Select (only if less than 2 selected)
      setSelectedAbilities([...selectedAbilities, ability]);
    }
  };

  const handleConfirm = () => {
    if (selectedAbilities.length === 2 && selectedFeat) {
      onConfirm(selectedAbilities as [AbilityScoreName, AbilityScoreName], selectedFeat);
      onClose();
    }
  };

  const canConfirm = selectedAbilities.length === 2 && selectedFeat !== null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Variant Human Customization</DialogTitle>
          <DialogDescription className="text-base">
            Your human adaptability grants you +1 to two abilities of your choice and one feat.
            <br />
            <span className="font-semibold text-foreground">
              Choose two abilities and one feat:
            </span>
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="abilities" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="abilities" className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Ability Scores ({selectedAbilities.length}/2)
            </TabsTrigger>
            <TabsTrigger value="feat" className="flex items-center gap-2">
              <Award className="w-4 h-4" />
              Feat {selectedFeat && '✓'}
            </TabsTrigger>
          </TabsList>

          <VariantHumanAbilityTab
            selectedAbilities={selectedAbilities}
            onToggleAbility={toggleAbility}
          />

          <VariantHumanFeatTab
            selectedFeat={selectedFeat}
            featCategory={featCategory}
            onFeatCategoryChange={setFeatCategory}
            onSelectFeat={setSelectedFeat}
          />
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Confirm Choices
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
