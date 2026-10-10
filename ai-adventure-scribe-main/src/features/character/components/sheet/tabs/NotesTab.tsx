import { FileText } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import PersonalityManager from '../PersonalityManager';
import CharacterOverview from './components/CharacterOverview';
import EditableDescription from './components/EditableDescription';
import EnhancementDetails from './components/EnhancementDetails';

import type { Character, CharacterSheetUpdateFn } from '@/types/character';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface NotesTabProps {
  character: Character;
  onUpdate: CharacterSheetUpdateFn;
}

/** #2701: session notes save debounced, so typing never triggers a save. */
const SESSION_NOTES_DEBOUNCE_MS = 800;

/**
 * Notes & Backstory tab for character roleplay information
 */
const NotesTab: React.FC<NotesTabProps> = ({ character, onUpdate }) => {
  const [notes, setNotes] = useState(character.sessionNotes || '');
  const { toast } = useToast();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The save closures below capture the latest values across renders.
  const latest = useRef({ character, notes, onUpdate });
  latest.current = { character, notes, onUpdate };

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    },
    [],
  );

  const saveSessionNotes = async (newNotes: string): Promise<boolean> => {
    const { character: currentCharacter, onUpdate: save } = latest.current;
    // Skip the write when nothing changed since the last known server value.
    if (newNotes === (currentCharacter.sessionNotes || '')) {
      return true;
    }
    return save({
      ...currentCharacter,
      sessionNotes: newNotes,
    });
  };

  const handleSessionNotesChange = (newNotes: string) => {
    setNotes(newNotes);
    // #2701: debounce — every keystroke used to call onUpdate, which
    // reloaded the sheet and kicked the user back to the Main tab.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      // Background autosave: silent. The persistence layer toasts on failure.
      void saveSessionNotes(newNotes);
    }, SESSION_NOTES_DEBOUNCE_MS);
  };

  const handleSessionNotesBlur = () => {
    // Flush any pending debounced save immediately on blur.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Blur is the explicit "I'm done" gesture, so confirm the save.
    // Capture dirtiness first: the silent post-save refresh updates the
    // server-known value before this resumes.
    void (async () => {
      const { notes: currentNotes, character: currentCharacter } = latest.current;
      if (currentNotes === (currentCharacter.sessionNotes || '')) {
        return;
      }
      const saved = await saveSessionNotes(currentNotes);
      if (saved) {
        toast({ title: 'Notes saved' });
      }
      // On failure the persistence layer already toasted; the text stays put.
    })();
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="personality">Personality</TabsTrigger>
          <TabsTrigger value="description">Description</TabsTrigger>
          <TabsTrigger value="enhancements">Enhancements</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <CharacterOverview character={character} onUpdate={onUpdate} />
        </TabsContent>

        {/* Personality Tab with Enhanced Manager */}
        <TabsContent value="personality">
          <PersonalityManager character={character} onUpdate={onUpdate} />
        </TabsContent>

        {/* Description Tab */}
        <TabsContent value="description">
          <div className="space-y-6">
            {/* Character Portrait and Description */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-500" />
                  Character Description
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Portrait */}
                  <div className="text-center">
                    {character.image_url ? (
                      <div className="w-48 h-48 mx-auto rounded-lg overflow-hidden border">
                        <img
                          src={character.image_url}
                          alt={`${character.name} portrait`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-48 h-48 mx-auto rounded-lg bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center text-6xl font-bold text-primary">
                        {character.name?.charAt(0).toUpperCase() || '?'}
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <div className="lg:col-span-2 space-y-4">
                    <EditableDescription
                      label="Appearance"
                      value={character.appearance || ''}
                      field="appearance"
                      character={character}
                      onUpdate={onUpdate}
                      placeholder="Describe your character's physical appearance..."
                      isAiGenerated={!!character.appearance}
                    />

                    <EditableDescription
                      label="Personality"
                      value={character.personality_traits || ''}
                      field="personality_traits"
                      character={character}
                      onUpdate={onUpdate}
                      placeholder="What makes your character unique? How do they act?"
                      isAiGenerated={!!character.personality_traits}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Backstory */}
            <Card>
              <CardHeader>
                <CardTitle>Backstory</CardTitle>
              </CardHeader>
              <CardContent>
                <EditableDescription
                  label="Backstory"
                  value={character.backstory_elements || ''}
                  field="backstory_elements"
                  character={character}
                  onUpdate={onUpdate}
                  placeholder="Tell your character's story. Where do they come from? What drives them? What are their goals?"
                  className="min-h-[150px]"
                  isAiGenerated={!!character.backstory_elements}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Enhancements Tab */}
        <TabsContent value="enhancements">
          <EnhancementDetails character={character} onUpdate={onUpdate} />
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes">
          <Card>
            <CardHeader>
              <CardTitle>Session Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(e) => handleSessionNotesChange(e.target.value)}
                onBlur={handleSessionNotesBlur}
                placeholder="Keep track of important events, NPCs met, quests received, and other session notes..."
                className="min-h-[300px] resize-none"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default NotesTab;
