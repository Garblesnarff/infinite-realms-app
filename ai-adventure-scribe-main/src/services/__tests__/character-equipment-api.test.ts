import { afterEach, describe, expect, it, vi } from 'vitest';

import { equipCharacterItem } from '../character-equipment-api';

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: () => ({ Authorization: 'Bearer <redacted>' }),
}));

/**
 * #1059 / AGENTS.md §4: the wire shape the in-session Equip control and
 * the combat picker's equip-and-attack choice send — POST with no body to
 * /v1/characters/:id/equip/:itemId, where the token is the equipment row
 * id or the item name. The same shape goes through the real route in
 * server-bun's character-equip-1059.real-db.test.ts.
 */
describe('equipCharacterItem wire shape (#1059)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts to the equip route with the token encoded and no body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, armorClass: 16 }),
    } as Response);

    const result = await equipCharacterItem('char-1', 'Crossbow, light');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/v1/characters/char-1/equip/Crossbow%2C%20light');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    // The route's re-synced stored AC rides back for the sheet to show.
    expect(result.armorClass).toBe(16);
  });

  it('throws when the route refuses, so the caller can show why', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(equipCharacterItem('char-1', 'Greataxe')).rejects.toThrow(
      'Unable to equip Greataxe.',
    );
  });
});
