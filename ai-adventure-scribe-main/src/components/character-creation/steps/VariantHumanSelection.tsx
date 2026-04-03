import { Users, Award, Settings, Eye } from 'lucide-react';
import React from 'react';

import { useVariantHumanSelection } from './variant-human/use-variant-human-selection';

import type { Feat } from '@/data/featOptions';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { feats, getFeatsByCategory } from '@/data/featOptions';

/**
 * VariantHumanSelection component for customizing Variant Human and Custom Lineage
 * Handles ability score selection, feat selection, and additional options
 */
const VariantHumanSelection: React.FC = (): JSX.Element => {
  const {
    isVariantHuman,
    isCustomLineage,
    selectedAbilities,
    selectedFeat,
    setSelectedFeat,
    selectedSkill,
    setSelectedSkill,
    selectedLanguage,
    setSelectedLanguage,
    selectedTool,
    setSelectedTool,
    hasdarkvision,
    setHasDarkvision,
    customLineageSize,
    setCustomLineageSize,
    availableAbilities,
    availableSkills,
    availableLanguages,
    availableTools,
    handleAbilitySelection,
    applySelections,
  } = useVariantHumanSelection();

  const getFeatCard = (feat: Feat): JSX.Element => (
    <Card
      key={feat.id}
      className={`cursor-pointer transition-all hover:shadow-md border-2 ${
        selectedFeat === feat.id ? 'border-primary bg-primary/5' : 'border-muted'
      }`}
      onClick={() => setSelectedFeat(feat.id)}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{feat.name}</CardTitle>
        <Badge variant="outline" className="w-fit text-xs">
          {feat.category}
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{feat.description}</p>
      </CardContent>
    </Card>
  );

  return !isVariantHuman && !isCustomLineage ? (
    <div className="text-center space-y-4">
      <Users className="w-16 h-16 mx-auto text-muted-foreground" />
      <h2 className="text-2xl font-bold">Standard Human</h2>
      <p className="text-muted-foreground">
        Your standard human receives +1 to all ability scores.
      </p>
      <p className="text-sm text-muted-foreground">No additional customization needed.</p>
    </div>
  ) : (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">
          {isVariantHuman ? 'Variant Human' : 'Custom Lineage'} Customization
        </h2>
        <p className="text-muted-foreground">
          Configure your {isVariantHuman ? 'variant human' : 'custom lineage'} traits and abilities
        </p>
      </div>

      {/* Ability Score Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Ability Score Increases
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isVariantHuman
              ? 'Choose 2 different ability scores to increase by 1 each'
              : 'Choose 1 ability score to increase by 2'}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {availableAbilities.map((ability) => (
              <div
                key={ability}
                className={`p-3 border rounded cursor-pointer transition-colors ${
                  selectedAbilities.includes(ability)
                    ? 'border-primary bg-primary/10'
                    : 'border-muted hover:border-primary/50'
                }`}
                onClick={() => handleAbilitySelection(ability)}
              >
                <div className="font-medium capitalize">{ability}</div>
                <div className="text-sm text-muted-foreground">{isVariantHuman ? '+1' : '+2'}</div>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Selected:{' '}
            {selectedAbilities.map((a) => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')}
          </p>
        </CardContent>
      </Card>

      {/* Feat Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5" />
            Choose a Feat
          </CardTitle>
          <p className="text-sm text-muted-foreground">Select a feat to gain at 1st level</p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="combat">Combat</TabsTrigger>
              <TabsTrigger value="magic">Magic</TabsTrigger>
              <TabsTrigger value="utility">Utility</TabsTrigger>
              <TabsTrigger value="social">Social</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                {feats.map(getFeatCard)}
              </div>
            </TabsContent>

            <TabsContent value="combat" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                {getFeatsByCategory('combat').map(getFeatCard)}
              </div>
            </TabsContent>

            <TabsContent value="magic" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                {getFeatsByCategory('magic').map(getFeatCard)}
              </div>
            </TabsContent>

            <TabsContent value="utility" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                {getFeatsByCategory('utility').map(getFeatCard)}
              </div>
            </TabsContent>

            <TabsContent value="social" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                {getFeatsByCategory('social').map(getFeatCard)}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Variant Human Skill Selection */}
      {isVariantHuman && (
        <Card>
          <CardHeader>
            <CardTitle>Skill Proficiency</CardTitle>
            <p className="text-sm text-muted-foreground">Choose one skill to gain proficiency in</p>
          </CardHeader>
          <CardContent>
            <RadioGroup value={selectedSkill} onValueChange={setSelectedSkill}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {availableSkills.map((skill) => (
                  <div key={skill} className="flex items-center space-x-2">
                    <RadioGroupItem value={skill} id={skill} />
                    <Label htmlFor={skill} className="text-sm">
                      {skill}
                    </Label>
                  </div>
                ))}
              </div>
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      {/* Language/Tool Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Additional Proficiency</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose an additional language or tool proficiency
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Language</Label>
            <RadioGroup value={selectedLanguage} onValueChange={setSelectedLanguage}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {availableLanguages.map((language) => (
                  <div key={language} className="flex items-center space-x-2">
                    <RadioGroupItem value={language} id={`lang-${language}`} />
                    <Label htmlFor={`lang-${language}`} className="text-sm">
                      {language}
                    </Label>
                  </div>
                ))}
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label className="text-sm font-medium">Tool Proficiency</Label>
            <RadioGroup value={selectedTool} onValueChange={setSelectedTool}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {availableTools.map((tool) => (
                  <div key={tool} className="flex items-center space-x-2">
                    <RadioGroupItem value={tool} id={`tool-${tool}`} />
                    <Label htmlFor={`tool-${tool}`} className="text-sm">
                      {tool}
                    </Label>
                  </div>
                ))}
              </div>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      {/* Custom Lineage Additional Options */}
      {isCustomLineage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Additional Traits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Size</Label>
              <RadioGroup
                value={customLineageSize}
                onValueChange={(value: 'small' | 'medium') => setCustomLineageSize(value)}
              >
                <div className="flex gap-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="small" id="small" />
                    <Label htmlFor="small">Small</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="medium" id="medium" />
                    <Label htmlFor="medium">Medium</Label>
                  </div>
                </div>
              </RadioGroup>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="darkvision"
                checked={hasdarkvision}
                onCheckedChange={(checked) => setHasDarkvision(checked === true)}
              />
              <Label htmlFor="darkvision">
                Darkvision (60 feet) - If not selected, gain an additional skill proficiency instead
              </Label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual Apply Button (fallback) */}
      <div className="flex justify-center">
        <Button onClick={applySelections} className="mt-4">
          Apply Customization
        </Button>
      </div>
    </div>
  );
};

export default VariantHumanSelection;
