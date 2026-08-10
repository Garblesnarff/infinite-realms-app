#!/usr/bin/env node
/**
 * SPIKE — Engine Ledger proof-of-concept. THROWAWAY. Not wired to anything.
 *
 * Demonstrates, on real playtest transcripts, that a deterministic narrative-fact
 * ledger built ONLY from events the server already resolves (roll requests, roll
 * results, combat boundaries) would have caught the continuity failures observed
 * in the Phase 2 playtests — with no LLM extraction at all. Target architecture:
 * docs/memory-system-design-v2.md §5; this spike models the pre-Phase-1 slice.
 *
 * Usage: node ledger-spike.mjs <transcript.log> [transcript2.log ...]
 * No dependencies. Reads logs, builds an in-memory bi-temporal fact ledger,
 * renders the <scene_state> block that WOULD have been injected, and reports
 * transcript statements that contradict then-current facts.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// ---------------------------------------------------------------- fact ledger
class Ledger {
  constructor() { this.facts = []; this.seq = 0; }

  /** Supersede-never-overwrite: same (subject,predicate) invalidates the old row. */
  assert(subject, predicate, value, source, turn) {
    const current = this.current(subject, predicate);
    if (current && JSON.stringify(current.value) === JSON.stringify(value)) return current;
    if (current) { current.invalidatedAt = turn; current.invalidatedBy = this.seq; }
    const fact = { id: this.seq++, subject, predicate, value, source, validFrom: turn,
                   invalidatedAt: null, invalidatedBy: null };
    this.facts.push(fact);
    return fact;
  }

  current(subject, predicate) {
    return this.facts.find(f => f.subject === subject && f.predicate === predicate
                             && f.invalidatedAt === null);
  }

  /** Render the ground-truth block for the prompt, as of "now". */
  sceneState() {
    const live = this.facts.filter(f => f.invalidatedAt === null);
    const bySubject = {};
    for (const f of live) (bySubject[f.subject] ??= []).push(f);
    const lines = ['<scene_state>',
      '<authority>These facts are TRUE. Never contradict them.</authority>'];
    for (const [subject, facts] of Object.entries(bySubject)) {
      lines.push(`  <entity name="${subject}">`);
      for (const f of facts)
        lines.push(`    ${f.predicate} = ${JSON.stringify(f.value)}  (${f.source}, turn ${f.validFrom})`);
      lines.push('  </entity>');
    }
    lines.push('</scene_state>');
    return lines.join('\n');
  }
}

// ------------------------------------------------------------- transcript parse
// Deterministic events only — every one of these corresponds to a server-side
// event the real engine already resolves and could write as a fact.
function parse(text) {
  const events = [];
  let turn = 0;
  let pendingRequests = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const req = line.match(/^Roll \d+: (\S+) — (.*)$/);
    if (req) {
      turn++;
      pendingRequests.push({ formula: req[1], purpose: req[2], turn });
      events.push({ kind: 'request', formula: req[1], purpose: req[2], turn });
    }
    const res = line.match(/^Rolled (\S+): (\d+)$/);
    if (res) {
      const match = pendingRequests.find(p => p.formula === res[1]) ?? pendingRequests[0];
      events.push({ kind: 'roll', formula: res[1], result: +res[2],
                    purpose: match?.purpose ?? '(unknown)', turn: match?.turn ?? turn });
      pendingRequests = pendingRequests.filter(p => p !== match);
    }
    if (/^Roll \d+: .*[Ii]nitiative/.test(line)) events.push({ kind: 'initiative', turn });
    if (line && !line.startsWith('Roll') && !line.startsWith('Rolled') &&
        !/^[0-9#]{2}/.test(line) && !line.startsWith('MAP') && !line.startsWith('TACTICAL') &&
        !/^[0-9a-f-]{36}@/.test(line) && !line.startsWith('{"type"'))
      events.push({ kind: 'prose', text: line, turn });
  }
  return events;
}

// ------------------------------------------------------------------- the spike
function run(file) {
  const events = parse(readFileSync(file, 'utf8'));
  const ledger = new Ledger();
  const contradictions = [];
  let combatIndex = 0;
  let currentEnemy = null;

  for (const ev of events) {
    // ENGINE EVENT: roll request purpose names the attack bonus for a weapon.
    // (In production this fact comes from the character sheet, not the model.)
    if (ev.kind === 'roll' && /attack/i.test(ev.purpose)) {
      const weapon = /longsword/i.test(ev.purpose) ? 'longsword' : 'weapon';
      const bonus = ev.formula.match(/^1d20([+-]\d+)$/)?.[1];
      const known = ledger.current('party', `attack_bonus:${weapon}`);
      if (bonus && !known) {
        ledger.assert('party', `attack_bonus:${weapon}`, bonus, 'engine(sheet)', ev.turn);
      } else if (bonus && known && known.value !== bonus) {
        contradictions.push({ turn: ev.turn, class: 'F4 sheet-fact drift',
          detail: `${weapon} attack requested at 1d20${bonus} but ledger holds 1d20${known.value} ` +
                  `(established turn ${known.validFrom}). Gateway would reject/correct the formula.` });
      }
      const target = ev.purpose.match(/against (?:the )?(.+)$/i)?.[1];
      if (target) currentEnemy = target.trim();
    }

    // ENGINE EVENT: symbolic formula — the class of bug that killed a 30-turn run.
    // Checked at REQUEST time: the '1d20+dex' run never resolved a single roll.
    if (ev.kind === 'request' && /\d*d\d+\+[a-z]/i.test(ev.formula)) {
      contradictions.push({ turn: ev.turn, class: 'F4 symbolic formula',
        detail: `Unresolvable formula '${ev.formula}' — <scene_state> carries numeric mods; ` +
                `gateway substitutes from sheet instead of stalling.` });
    }

    // ENGINE EVENT: a *second* initiative means the previous encounter ended —
    // the engine knows the outcome; the ledger records the defeated enemy.
    if (ev.kind === 'initiative') {
      combatIndex++;
      if (combatIndex > 1 && currentEnemy) {
        ledger.assert(currentEnemy.toLowerCase(), 'status',
          { state: 'dead', encounter: combatIndex - 1 }, 'engine(combat_end)', ev.turn);
        currentEnemy = null;
      }
    }

    // ENGINE EVENT: resolved roll whose purpose says what was being learned.
    if (ev.kind === 'roll' && /perception.*(warning|instruction)/i.test(ev.purpose) && ev.result >= 15) {
      ledger.assert('party', 'learned:balthazar_warning',
        { confirmed: true, roll: ev.result }, 'engine(roll_outcome)', ev.turn);
    }

    // CONTRADICTION CHECKS: prose vs then-current ledger.
    if (ev.kind === 'prose') {
      const learned = ledger.current('party', 'learned:balthazar_warning');
      if (learned && /(one more chance to listen|lost warning|will not reveal itself)/i.test(ev.text)) {
        contradictions.push({ turn: ev.turn, class: 'F1 resolved-beat regression',
          detail: `DM reruns the listening beat after ledger holds learned:balthazar_warning ` +
                  `(confirmed turn ${learned.validFrom}, roll ${learned.value.roll}): "${ev.text.slice(0, 90)}…"` });
      }
      for (const f of ledger.facts) {
        if (f.predicate === 'status' && f.value.state === 'dead' && f.invalidatedAt === null &&
            new RegExp(f.subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(ev.text) &&
            /(lunge|attack|prepares|readies|strikes)/i.test(ev.text)) {
          contradictions.push({ turn: ev.turn, class: 'F1 dead-creature reintroduction',
            detail: `"${f.subject}" acts after status=dead (turn ${f.validFrom}): "${ev.text.slice(0, 90)}…"` });
        }
      }
    }
  }

  // ------------------------------------------------------------------ report
  console.log(`\n═══ ${basename(file)} ═══`);
  console.log(`\n— Ledger built from deterministic events only (${ledger.facts.length} facts) —`);
  for (const f of ledger.facts) {
    const status = f.invalidatedAt === null ? 'CURRENT' : `superseded@turn${f.invalidatedAt}`;
    console.log(`  [${status}] (${f.subject}, ${f.predicate}) = ${JSON.stringify(f.value)} ` +
                `← ${f.source}, turn ${f.validFrom}`);
  }
  console.log(`\n— <scene_state> block that would be injected next turn —\n`);
  console.log(ledger.sceneState());
  console.log(`\n— Contradictions the ledger catches in this transcript: ${contradictions.length} —`);
  for (const c of contradictions) console.log(`  · turn ~${c.turn} [${c.class}] ${c.detail}`);
  if (!contradictions.length) console.log('  (none detected by the three spike rules)');
}

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node ledger-spike.mjs <transcript.log> …'); process.exit(1); }
for (const f of files) run(f);
