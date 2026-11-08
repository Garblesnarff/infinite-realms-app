import React from 'react';

import { StorySoFarLink } from './StorySoFarLink';

import type { JournalHandoutEntry } from '@/services/user-data-api';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useOptionalCampaign } from '@/contexts/CampaignContext';
import { HandoutCard } from '@/features/game-session/components/handouts/HandoutCard';

export interface JournalTabContentProps {
  sessionId?: string;
  sessionNotesId: string;
  localSessionNotes: string;
  setLocalSessionNotes: (notes: string) => void;
  handleSaveNotes: () => void;
  notesPlaceholder: string;
  journalEntries: JournalHandoutEntry[];
  journalLoading: boolean;
}

/**
 * Journal tab body shared by the desktop panel and the mobile sheet (#1429,
 * Panels board): handouts, the objective, MY NOTES, and the "Story so far" link.
 * Session notes moved here from the Memory tab; the Save button stays because
 * notes have no autosave. The objective is the campaign description, the only
 * producer in the app (useOverhaulViewModel falls back to "Your adventure awaits.").
 */
export const JournalTabContent: React.FC<JournalTabContentProps> = ({
  sessionId,
  sessionNotesId,
  localSessionNotes,
  setLocalSessionNotes,
  handleSaveNotes,
  notesPlaceholder,
  journalEntries,
  journalLoading,
}) => {
  const campaign = useOptionalCampaign()?.state.campaign;
  const objective = campaign?.description || 'Your adventure awaits.';

  return (
    <div className="space-y-5 p-4">
      <h2 className="text-lg font-semibold [body.ir-table-look_&]:font-['Cinzel',serif] [body.ir-table-look_&]:text-[19px] [body.ir-table-look_&]:text-[#f3deb0]">
        Journal
      </h2>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground [body.ir-table-look_&]:tracking-[0.14em] [body.ir-table-look_&]:!text-[#aab3cc]">
          Handouts
        </h3>
        {journalLoading && <p className="text-xs text-muted-foreground">Loading journal...</p>}
        {!journalLoading && journalEntries.length === 0 && (
          <p className="text-xs text-muted-foreground">No handouts delivered yet.</p>
        )}
        {Object.entries(
          journalEntries.reduce<Record<string, JournalHandoutEntry[]>>((groups, entry) => {
            const label =
              entry.sessionNumber == null ? 'This campaign' : `Session ${entry.sessionNumber}`;
            (groups[label] ||= []).push(entry);
            return groups;
          }, {}),
        ).map(([session, entries]) => (
          <section key={session} className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground [body.ir-table-look_&]:tracking-[0.14em] [body.ir-table-look_&]:!text-[#aab3cc]">
              {session}
            </h4>
            {entries.map((entry) => (
              <HandoutCard key={entry.id} entry={entry} />
            ))}
          </section>
        ))}
      </section>

      {campaign && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground [body.ir-table-look_&]:tracking-[0.14em] [body.ir-table-look_&]:!text-[#aab3cc]">
            Objective
          </h3>
          <p className="text-base leading-relaxed [body.ir-table-look_&]:text-[#eaeefa]">
            {objective}
          </p>
        </section>
      )}

      <section className="space-y-2">
        <Label
          htmlFor={sessionNotesId}
          className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground [body.ir-table-look_&]:tracking-[0.14em] [body.ir-table-look_&]:!text-[#aab3cc]"
        >
          My Notes
        </Label>
        <Textarea
          id={sessionNotesId}
          value={localSessionNotes}
          onChange={(e) => setLocalSessionNotes(e.target.value)}
          placeholder={notesPlaceholder}
          rows={5}
          className="resize-none rounded-lg border-white/10 bg-white/[0.03] text-sm focus:border-infinite-teal/50 focus:ring-2 focus:ring-infinite-teal/20 [body.ir-table-look_&]:rounded-[10px] [body.ir-table-look_&]:border-[rgba(213,176,112,0.35)] [body.ir-table-look_&]:bg-[#070b14] [body.ir-table-look_&]:font-['EB_Garamond',Georgia,serif] [body.ir-table-look_&]:text-[18px] [body.ir-table-look_&]:leading-[1.45] [body.ir-table-look_&]:text-[#eaeefa]"
        />
        <p className="text-[13px] text-muted-foreground [body.ir-table-look_&]:!text-[#98a3c2]">
          Only you can see your notes.
        </p>
        <Button onClick={handleSaveNotes} size="sm" variant="ir-gold" className="w-full">
          Save Notes
        </Button>
      </section>

      {sessionId && <StorySoFarLink sessionId={sessionId} />}
    </div>
  );
};
