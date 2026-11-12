/**
 * The personality envelope a sheet writes to save a Sorcerer's Metamagic (#1233). The create and
 * update routes take it as `personality_notes`. The real-route suite posts these bodies; the client
 * round-trip test serializes the same shape.
 */
export const metamagicEnvelopeJson = (options: string[]) =>
  JSON.stringify({
    traits: [],
    ideals: [],
    bonds: [],
    flaws: [],
    inspiration: false,
    lastInspiration: null,
    inspirationHistory: [],
    metamagicOptions: options,
  });

/** A level 3 Sorcerer knows two options: this is the valid body. */
export const metamagicValidBody = {
  personality_notes: metamagicEnvelopeJson(['quickened', 'careful']),
};
/** Three options at level 3 is over the 2014 cap of two. */
export const metamagicOverCapBody = {
  personality_notes: metamagicEnvelopeJson(['quickened', 'careful', 'subtle']),
};
/** An id that is not one of the eight options. */
export const metamagicUnknownIdBody = { personality_notes: metamagicEnvelopeJson(['haste']) };
