import { describe, it, expect } from 'vitest';

import { parseXMLTagsFromResponse } from '../xml-parser';

describe('parseXMLTagsFromResponse', () => {
  it('should return pure narrative when no tags are present', () => {
    const response = 'This is a normal narrative response without any tags.';
    const result = parseXMLTagsFromResponse(response);

    expect(result.narrative).toBe(response);
    expect(result.memories).toEqual([]);
    expect(result.worldUpdates.npcs).toEqual([]);
    expect(result.worldUpdates.locations).toEqual([]);
    expect(result.worldUpdates.quests).toEqual([]);
    expect(result.hadTags).toBe(false);
  });

  it('should extract memories and clean narrative', () => {
    const response = `The dragon roars, its scales glistening in the torchlight.
<memories>
- The dragon's name is Ignis.
- Ignis is vulnerable to cold damage.
</memories>`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.narrative).toBe('The dragon roars, its scales glistening in the torchlight.');
    expect(result.memories).toEqual([
      "The dragon's name is Ignis.",
      'Ignis is vulnerable to cold damage.',
    ]);
    expect(result.hadTags).toBe(true);
  });

  it('should extract NPC updates correctly', () => {
    const response = `You meet Elara in the tavern.
<world_updates>
- npc: Elara | A mysterious wood elf rogue | The Rusty Tankard
</world_updates>`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.worldUpdates.npcs).toEqual([
      {
        name: 'Elara',
        description: 'A mysterious wood elf rogue',
        location: 'The Rusty Tankard',
      },
    ]);
    expect(result.hadTags).toBe(true);
  });

  it('should extract Location updates correctly', () => {
    const response = `The cave entrance is now blocked by a rockfall.
<world_updates>
- location: Darkreach Cave | A deep limestone cavern | Blocked
</world_updates>`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.worldUpdates.locations).toEqual([
      {
        name: 'Darkreach Cave',
        description: 'A deep limestone cavern',
        status: 'Blocked',
      },
    ]);
    expect(result.hadTags).toBe(true);
  });

  it('should extract Quest updates correctly', () => {
    const response = `The merchant is grateful for the returned locket.
<world_updates>
- quest: The Lost Locket | Completed
</world_updates>`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.worldUpdates.quests).toEqual([
      {
        name: 'The Lost Locket',
        update: 'Completed',
      },
    ]);
    expect(result.hadTags).toBe(true);
  });

  it('should handle multiple updates of different types', () => {
    const response = `The village is safe for now.
<world_updates>
- npc: Mayor Tom | Relieved village leader | Town Hall
- location: Greenvale | A peaceful farming village | Safe
- quest: Save Greenvale | Successful
</world_updates>`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.worldUpdates.npcs).toHaveLength(1);
    expect(result.worldUpdates.locations).toHaveLength(1);
    expect(result.worldUpdates.quests).toHaveLength(1);
  });

  it('should handle combined memories and world updates', () => {
    const response = `Victory is yours!
<memories>
- Defeated the goblin king.
</memories>
<world_updates>
- quest: Goblin Menace | Resolved
</world_updates>`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.narrative).toBe('Victory is yours!');
    expect(result.memories).toEqual(['Defeated the goblin king.']);
    expect(result.worldUpdates.quests).toEqual([{ name: 'Goblin Menace', update: 'Resolved' }]);
    expect(result.hadTags).toBe(true);
  });

  it('should handle empty or whitespace-only tags gracefully', () => {
    const response = `Empty tags test.
<memories>
</memories>
<world_updates>
</world_updates>`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.narrative).toBe('Empty tags test.');
    expect(result.memories).toEqual([]);
    expect(result.worldUpdates.npcs).toEqual([]);
    expect(result.hadTags).toBe(true);
  });

  it('should be case-insensitive for tag names', () => {
    const response = `Narrative text.
<MEMORIES>
- Uppercase memory
</MEMORIES>
<WORLD_UPDATES>
- quest: Quest Name | Update
</WORLD_UPDATES>`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.memories).toEqual(['Uppercase memory']);
    expect(result.worldUpdates.quests).toEqual([{ name: 'Quest Name', update: 'Update' }]);
    expect(result.hadTags).toBe(true);
  });

  it('should handle malformed world update lines gracefully', () => {
    const response = `Malformed lines test.
<world_updates>
- npc: Incomplete Line
- location: Missing | Parts
- quest: Valid | Quest
</world_updates>`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.worldUpdates.npcs).toHaveLength(0);
    expect(result.worldUpdates.locations).toHaveLength(0);
    expect(result.worldUpdates.quests).toEqual([{ name: 'Valid', update: 'Quest' }]);
  });

  it('should handle narrative text between tags', () => {
    const response = `<memories>- Memory 1</memories> Middle text <world_updates>- quest: Q1 | U1</world_updates> End text`;
    const result = parseXMLTagsFromResponse(response);

    expect(result.narrative).toBe('Middle text  End text');
    expect(result.memories).toEqual(['Memory 1']);
    expect(result.worldUpdates.quests).toEqual([{ name: 'Q1', update: 'U1' }]);
  });
});
