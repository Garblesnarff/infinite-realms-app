import { engineLineUuid } from './engine-chat-line.js';

/** Claim a session/character/turn effect through the target event table's unique ID. */
export async function claimStoryEffect(
  seed: string,
  insert: (id: string) => Promise<Array<{ id: string }>>,
): Promise<string | null> {
  const id = engineLineUuid(seed);
  const rows = await insert(id);
  return rows.some((row) => row.id === id) ? id : null;
}
