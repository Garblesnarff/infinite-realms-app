/**
 * False-positive set for the #2236 narration post-check: real DM narrations, verbatim,
 * that must produce ZERO violations. Every violation costs a regeneration call, and a
 * false one turns good prose into robot text.
 *
 * Sources:
 * - The "Report — run" issues: #2230 (run 10), #2231 (run M4), #2189 (run 9), #2188 (run M3).
 * - The recorded stranger-test run, playtests/2026-09-05-stranger-test.md (Abyssal Descent).
 *   The reports' own markdown bold is stripped; the words are unchanged.
 * - Round-3 additions: the inch-mark/quote-pairing cases (#2236), which must stay clean.
 *
 * Excluded on purpose: passages a report documents as the failures this check exists to
 * catch (invented Dash, "not your turn", flurry for one attack, "swings true" on a miss,
 * rope → stone-floor drift), and fabricated outcomes a stricter check might one day catch
 * (#2189's rollless "blade whistling" attack, the stranger test's rollless punch). A
 * zero-violation assertion on those would lock the miss in. Passages flagged for defects
 * this check does not guard (doubled article, stat-block names, a voice note leaking into
 * prose) are kept: they are real narration and must not trip it.
 *
 * Each passage is checked against its recorded setting AND against the harshest contracts:
 * nothing resolved on the player's turn over a rope/chasm, a single missed NPC attack, and
 * an Academy scene — so the assertion covers every rule that could fire.
 */
import { describe, expect, it } from 'vitest';

import { checkNarrationAgainstContract, type ContractEnvelope } from '../narration-contract-check';

type RecordedNarration = { source: string; context: string; scene: string; text: string };

const REAL_NARRATIONS: RecordedNarration[] = [
  // #2230 — Report — run 10 (Terra, Abyssal Descent)
  {
    source: '#2230',
    context: 'Captain Reeves, pre-combat',
    scene: 'A ledge above the chasm.',
    text: 'We are here to survive, not to hope.',
  },
  {
    source: '#2230',
    context: 'Captain Reeves, acknowledging the player',
    scene: 'The chasm descent, on the rope.',
    text: 'Understood, Veteran. We are securing the line now.',
  },
  {
    source: '#2230',
    context: 'Darkwater, frantic',
    scene: 'The chasm descent, on the rope.',
    text: 'It wants us, it wants us all, yes?',
  },
  {
    source: '#2230',
    context: "narration of Darkwater's fear",
    scene: 'The chasm descent, on the rope.',
    text: 'a terrifying, wide-eyed hunger',
  },
  {
    source: '#2230',
    context: 'Darkwater voice description (flagged as a note leaking into prose)',
    scene: 'The chasm descent, on the rope.',
    text: 'her voice a low, raspy rasp that carries no contractions',
  },
  {
    source: '#2230',
    context: 'exploration, establishing the rope descent',
    scene: 'Hanging from a rope over a chasm.',
    text: 'dangling you helplessly over the abyss',
  },
  {
    source: '#2230',
    context: 'combat round 2, spider kept at range, no attack rolled (report: correct)',
    scene: 'Hanging from a rope over a chasm.',
    text: 'keeps it just out of your reach',
  },
  {
    source: '#2230',
    context: 'exploration after the fight (flagged: doubled article)',
    scene: 'The Throat of Basalt.',
    text: 'the The Throat of Basalt',
  },
  {
    source: '#2230',
    context: 'combat end, spider at 0 HP',
    scene: 'Hanging from a rope over a chasm.',
    text: 'Combat has ended.',
  },
  // #2189 — Report — run 9 (Terra)
  {
    source: '#2189',
    context: 'combat, player turn, target 55 ft away, no attack rolled (report: consistent)',
    scene: 'The chasm, Abyssal Descent.',
    text: '…You lunge forward to intercept them, but they remain just beyond your reach…',
  },
  {
    source: '#2189',
    context: 'Captain Reeves, pre-combat',
    scene: 'A ledge above the chasm.',
    text: "I'd rather be slow and alive than fast and falling.",
  },
  {
    source: '#2189',
    context: 'combat intro (flagged: stat-block names)',
    scene: 'The chasm, Abyssal Descent.',
    text: 'The Chiropteran Hulk 1 and a second, Chiropteran Hulk 2, descend from the gloom',
  },
  // #2188 — Report — run M3 (Muse, The Eternal Feast)
  {
    source: '#2188',
    context: "Balthazar's challenge, fight hook",
    scene: 'The Infinite Kitchen, The Eternal Feast.',
    text: 'prove it here and now',
  },
  {
    source: '#2188',
    context: "Remy's warning, story hook",
    scene: 'The dining room, The Eternal Feast.',
    text: 'do not look directly into the kitchen window when the fire elementals are in a mood',
  },
  {
    source: '#2188',
    context: 'narration (flagged: duplicated name)',
    scene: 'The Infinite Kitchen, The Eternal Feast.',
    text: "The Balthazar Head Chef Balthazar doesn't stop his frantic, masterful cooking…",
  },
  // Recorded stranger-test run, playtests/2026-09-05-stranger-test.md (Abyssal Descent)
  {
    source: 'stranger test',
    context: 'opening scene (flagged: duplicated location name)',
    scene: 'The chasm mouth, the wind-tunnels howling.',
    text: "...the ghost of a heartbeat that isn't yours. The Wind Tunnels The wind-tunnels hiss, a sound that mimics human weeping...",
  },
  {
    source: 'stranger test',
    context: 'end of the opening message',
    scene: 'The chasm mouth, the wind-tunnels howling.',
    text: 'The expedition has begun, and there is no way but down.',
  },
  {
    source: 'stranger test',
    context: 'exploration, pressing Darkwater at the fused lift',
    scene: 'The calcified wreckage of the lift at the chasm edge.',
    text: 'You turn from the calcified wreckage of the lift, your eyes narrowing as you fix your gaze on the expedition leader. The orange light of his flare flickers across his gaunt features, highlighting the hollows of his cheeks.',
  },
  {
    source: 'stranger test',
    context: 'player speech voiced by the DM',
    scene: 'The calcified wreckage of the lift at the chasm edge.',
    text: '"Professor," you press, your voice low and steady against the howling wind-tunnels, "you speak as if you expected this mechanism to be sabotaged. You don\'t seem concerned that our exit—or our lifeline—has been rendered useless. Why is that? What exactly did you know before we stepped into this chasm?"',
  },
  {
    source: 'stranger test',
    context: 'failed DEX save on a jump (finding is the missing damage roll, not the prose)',
    scene: 'The chasm, a ledge of volcanic glass.',
    text: '...the slick, volcanic glass betrays your footing at the final second. Your jump turns into a chaotic, flailing tumble; you strike the jagged wall hard, the breath driven from your lungs as you bounce against the freezing stone. You plummet, the darkness rushing up to greet you...',
  },
  {
    source: 'stranger test',
    context: 'the fall (report: "The narration is good")',
    scene: 'The chasm, falling.',
    text: 'You plummet, the darkness rushing up to greet you, gravity pulling you deeper into the maw of the earth.',
  },
  {
    source: 'stranger test',
    context: 'exploration (flagged: doubled article)',
    scene: 'The Throat of Basalt.',
    text: 'casting frantic, erratic light across the The Throat of Basalt',
  },
  {
    source: 'stranger test',
    context: 'exploration (flagged: doubled article)',
    scene: 'The Throat of Basalt.',
    text: 'you lunge into the The Throat of Basalt',
  },
  {
    source: 'stranger test',
    context: 'failed Perception (flagged: doubled article)',
    scene: 'The Ossuary of Silence.',
    text: 'Your senses, dulled by the brutal descent and your own white-hot fury, fail you in the suffocating stillness of the The Ossuary of Silence.',
  },
  // #2236 round 3 — quote-pairing false positives (narratorVoice)
  {
    source: '#2236 round 3',
    context: 'stray inch mark before quoted turn denial (pairing must not shift)',
    scene: 'Hanging from a rope over a chasm.',
    text: 'The sign reads 6" tall. "You cannot act yet," the priest warns.',
  },
  {
    source: '#2236 round 3',
    context: 'multi-paragraph: inch mark in one paragraph, quoted speech in the next',
    scene: 'Hanging from a rope over a chasm.',
    text: 'The sign reads 6" tall.\n\n"You cannot act yet," the priest warns, "or the spider will strike."',
  },
];

const PLAYER_TURN_NOTHING_RESOLVED_ON_ROPE: ContractEnvelope = {
  currentTurn: { slug: 'the-veteran', isPlayer: true, round: 2 },
  actions: [],
  sceneDescription: 'Hanging from a rope over a chasm, the Throat of Basalt below.',
};
const NPC_SINGLE_MISS_ON_ROPE: ContractEnvelope = {
  currentTurn: { slug: 'vitruvian-spider', isPlayer: false, round: 2 },
  actions: [{ kind: 'attack', count: 1, hit: false, mixed: false }],
  sceneDescription: 'Hanging from a rope over a chasm, the Throat of Basalt below.',
};
const ACADEMY_PLAYER_TURN: ContractEnvelope = {
  currentTurn: { slug: 'rook', isPlayer: true, round: 1 },
  actions: [],
  sceneDescription: 'The Grand Kitchen, Academy of Arcane Gastronomy.',
};

describe('real DM narrations produce zero violations', () => {
  it('has at least 20 recorded narrations', () => {
    expect(REAL_NARRATIONS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(REAL_NARRATIONS.map((n) => [`${n.source}: ${n.context}`, n] as const))(
    '%s',
    (_label, narration) => {
      const recorded: ContractEnvelope = {
        ...PLAYER_TURN_NOTHING_RESOLVED_ON_ROPE,
        sceneDescription: narration.scene,
      };
      for (const contract of [
        recorded,
        PLAYER_TURN_NOTHING_RESOLVED_ON_ROPE,
        NPC_SINGLE_MISS_ON_ROPE,
        ACADEMY_PLAYER_TURN,
      ]) {
        expect(checkNarrationAgainstContract(narration.text, contract)).toEqual([]);
      }
    },
  );
});
