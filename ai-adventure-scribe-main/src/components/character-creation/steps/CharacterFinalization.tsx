import { Loader2, Sparkles, Image as ImageIcon, Wand2, CheckCircle, ImageOff } from 'lucide-react';
import React, { useId } from 'react';

import { useCharacterFinalization } from './character-finalization/use-character-finalization';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/**
 * CharacterFinalization component for character creation
 * Final step to review character, generate AI description and detailed design sheet
 */
const CharacterFinalization: React.FC = () => {
  const descriptionId = useId();
  const themeId = useId();

  const {
    state,
    isGeneratingDescription,
    isGeneratingAvatar,
    isGeneratingImage,
    selectedTheme,
    setSelectedTheme,
    generationStep,
    imageQuota,
    handleDescriptionChange,
    handleGenerateDescription,
    handleGenerateAvatar,
    handleGenerateImage,
  } = useCharacterFinalization();
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-center mb-6">Finalize Your Character</h2>

      {/* Character Summary */}
      <div className="bg-muted/50 p-4 rounded-lg border">
        <h3 className="font-semibold mb-3 flex items-center">
          <CheckCircle className="mr-2 h-5 w-5 text-green-600" />
          Character Summary
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <strong>Name:</strong> {state.character?.name || 'Not set'}
          </div>
          <div>
            <strong>Race:</strong> {state.character?.race?.name || 'Not selected'}
          </div>
          <div>
            <strong>Class:</strong> {state.character?.class?.name || 'Not selected'}
          </div>
          <div>
            <strong>Background:</strong> {state.character?.background?.name || 'Not selected'}
          </div>
          <div>
            <strong>Alignment:</strong> {state.character?.alignment || 'Not set'}
          </div>
          <div>
            <strong>Level:</strong> {state.character?.level || 1}
          </div>
        </div>
      </div>

      {/* Proficiencies Summary */}
      {state.character && (
        <div className="bg-muted/50 p-4 rounded-lg border">
          <h3 className="font-semibold mb-3 flex items-center">
            <CheckCircle className="mr-2 h-5 w-5 text-green-600" />
            Proficiencies & Languages
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm space-y-2">
            <div>
              <strong>Skills:</strong>{' '}
              {(state.character.skillProficiencies?.length || 0) > 0
                ? state.character.skillProficiencies?.join(', ') || 'None'
                : 'None'}
            </div>
            <div>
              <strong>Tools:</strong>{' '}
              {(state.character.toolProficiencies?.length || 0) > 0
                ? state.character.toolProficiencies?.join(', ') || 'None'
                : 'None'}
            </div>
            <div>
              <strong>Saving Throws:</strong>{' '}
              {(state.character.savingThrowProficiencies?.length || 0) > 0
                ? (state.character.savingThrowProficiencies || [])
                    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                    .join(', ')
                : 'None'}
            </div>
            <div>
              <strong>Languages:</strong>{' '}
              {(state.character.languages?.length || 0) > 0
                ? state.character.languages?.join(', ') || 'None'
                : 'None'}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Description */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={descriptionId}>Character Description</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateDescription}
                disabled={isGeneratingDescription || !state.character?.name?.trim()}
                className="ml-2"
              >
                {isGeneratingDescription ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-4 w-4" />
                    {state.character?.description?.trim() ? 'Regenerate' : 'Generate'} with AI
                  </>
                )}
              </Button>
            </div>
            <Textarea
              id={descriptionId}
              placeholder="Generate an AI description using all your character choices, or write your own..."
              value={state.character?.description || ''}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              className="min-h-[200px] w-full"
            />
          </div>

          {/* Additional AI-generated fields display */}
          {state.character?.appearance && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">AI-Generated Appearance</Label>
              <p className="text-sm p-3 bg-muted/50 rounded-md border">
                {state.character.appearance}
              </p>
            </div>
          )}

          {state.character?.personality_traits && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">AI-Generated Personality</Label>
              <p className="text-sm p-3 bg-muted/50 rounded-md border">
                {state.character.personality_traits}
              </p>
            </div>
          )}

          {state.character?.backstory_elements && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                AI-Generated Backstory Elements
              </Label>
              <p className="text-sm p-3 bg-muted/50 rounded-md border">
                {state.character.backstory_elements}
              </p>
            </div>
          )}
        </div>

        {/* Right Column - Character Images */}
        <div className="space-y-4">
          {/* Theme Selector */}
          <div className="space-y-2">
            <Label htmlFor={themeId}>Design Sheet Theme</Label>
            <Select value={selectedTheme} onValueChange={setSelectedTheme}>
              <SelectTrigger id={themeId} className="w-full" aria-label="Select design sheet theme">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fantasy">Fantasy (Default)</SelectItem>
                <SelectItem value="cyberpunk">Cyberpunk</SelectItem>
                <SelectItem value="sci-fi">Sci-Fi</SelectItem>
                <SelectItem value="steampunk">Steampunk</SelectItem>
                <SelectItem value="dystopian">Dystopian</SelectItem>
                <SelectItem value="anime">Anime</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Image Generation Quota Tracker */}
          {imageQuota && (
            <div
              className={`p-3 rounded-lg border ${imageQuota.remaining === 0 ? 'bg-destructive/10 border-destructive/30' : 'bg-muted/50'}`}
            >
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {imageQuota.remaining === 0 ? (
                    <ImageOff className="h-4 w-4 text-destructive" />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span
                    className={
                      imageQuota.remaining === 0
                        ? 'text-destructive font-medium'
                        : 'text-muted-foreground'
                    }
                  >
                    {imageQuota.remaining === 0
                      ? 'Daily limit reached'
                      : `${imageQuota.remaining} image generation${imageQuota.remaining === 1 ? '' : 's'} remaining today`}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {imageQuota.usage}/{imageQuota.limits.daily.image}
                </span>
              </div>
              {imageQuota.remaining === 0 && (
                <p className="text-xs text-destructive mt-1">Resets at midnight UTC</p>
              )}
            </div>
          )}

          {/* Avatar Portrait */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Character Avatar</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateAvatar}
                disabled={
                  isGeneratingAvatar ||
                  !state.character?.name?.trim() ||
                  imageQuota?.remaining === 0
                }
              >
                {isGeneratingAvatar ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <ImageIcon className="mr-2 h-4 w-4" />
                    {state.character?.avatar_url ? 'Regenerate' : 'Generate'} Avatar
                  </>
                )}
              </Button>
            </div>

            {/* Avatar Preview */}
            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 h-64 flex items-center justify-center bg-muted/20">
              {state.character?.avatar_url ? (
                <img
                  src={state.character.avatar_url}
                  alt={`Avatar of ${state.character.name}`}
                  className="max-h-full max-w-full object-contain rounded-lg shadow-lg"
                />
              ) : (
                <div className="text-center text-muted-foreground">
                  <ImageIcon className="mx-auto h-10 w-10 mb-2" />
                  <p className="text-xs">Generate avatar first (portrait style)</p>
                </div>
              )}
            </div>
          </div>

          {/* Character Design Sheet */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Character Design Sheet</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateImage}
                disabled={
                  isGeneratingImage || !state.character?.name?.trim() || imageQuota?.remaining === 0
                }
              >
                {isGeneratingImage ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {generationStep === 'sheet' && 'Creating Sheet...'}
                  </>
                ) : (
                  <>
                    <ImageIcon className="mr-2 h-4 w-4" />
                    {state.character?.image_url ? 'Regenerate' : 'Generate'} Design Sheet
                  </>
                )}
              </Button>
            </div>

            {/* Image Preview */}
            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 h-64 flex items-center justify-center bg-muted/20">
              {state.character?.image_url ? (
                <img
                  src={state.character.image_url}
                  alt={`Design sheet of ${state.character.name}`}
                  className="max-h-full max-w-full object-contain rounded-lg shadow-lg"
                />
              ) : (
                <div className="text-center text-muted-foreground">
                  <ImageIcon className="mx-auto h-10 w-10 mb-2" />
                  <p className="text-xs">Generate character sheet with multiple views</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI Generation Tip */}
      <div className="bg-emerald-500/10 p-4 rounded-lg border border-emerald-500/30">
        <div className="flex items-start space-x-3">
          <Sparkles className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-emerald-400 mb-1">Enhanced AI Generation</p>
            <p className="text-foreground/80">
              Generate in order: First create a portrait <strong>Avatar</strong>, then the{' '}
              <strong>Character Sheet</strong> will use it as reference for consistency! The avatar
              will be used throughout the app for character identification in chats, character
              lists, and more.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterFinalization;
