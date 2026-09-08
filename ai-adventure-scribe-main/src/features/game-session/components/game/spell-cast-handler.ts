export type SpellCastHandler = (
  message: string,
  context: {
    intent: 'spell_cast';
    spellId: string;
    spellLevel: number | null;
  },
) => Promise<void>;

export type SpellCastHandlerRef = {
  current: SpellCastHandler | null;
};
