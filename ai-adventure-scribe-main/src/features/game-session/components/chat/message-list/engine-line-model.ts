export type EngineLineOutcome =
  | 'hit'
  | 'critical'
  | 'miss'
  | 'enemy-hit'
  | 'enemy-miss'
  | 'pass'
  | 'fail'
  | 'refused'
  | 'saved'
  | 'failed-save'
  | 'pending'
  | 'move'
  | 'info';

export interface EngineLineModel {
  badge: string;
  actorSide: 'player' | 'npc';
  kicker: string;
  math: string | null;
  detail: string | null;
  outcome: EngineLineOutcome;
  pill: string;
  raw: string;
}

export interface EngineLineCheckContext {
  kind: 'check';
  label: string;
  die: number;
  modifier: number;
  total: number;
  dc: number;
  outcome: string;
}

const SLUG_REGEX = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi;

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function nameForSlug(
  slug: string,
  opts?: { nameFor?: (slug: string) => string | undefined },
): string {
  const resolved = opts?.nameFor?.(slug);
  if (resolved && resolved.trim()) return resolved;
  return humanizeSlug(slug);
}

export function replaceSlugs(
  text: string,
  opts?: { nameFor?: (slug: string) => string | undefined },
): string {
  return text.replace(SLUG_REGEX, (slug) => nameForSlug(slug, opts));
}

export function replaceEnemyHp(text: string): string {
  return text.replace(/(.+?)\s+is now at\s+(-?\d+)\s+HP/gi, (_match, target, n) => {
    const num = Number(n);
    return `${String(target).trim()} is ${num > 0 ? 'bloodied' : 'down'}`;
  });
}

export function humanizeEngineLine(
  text: string,
  opts?: { nameFor?: (slug: string) => string | undefined },
): string {
  return replaceEnemyHp(replaceSlugs(text, opts));
}

export function stripEnginePrefix(line: string): string {
  return line.replace(/^[ \t]*⚙(?:️)?[ \t]*Engine:\s*/i, '').trim();
}

export function isEngineLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\n/.test(trimmed)) return false;
  return /^[ \t]*⚙(?:️)?[ \t]*Engine:/i.test(trimmed);
}

function isPlayerTarget(target: string): boolean {
  const t = target.trim().toLowerCase();
  if (t === 'you') return true;
  if (t.includes('scholar')) return true;
  return false;
}

function isPlayerActor(actor: string): boolean {
  const a = actor.trim().toLowerCase();
  if (a.includes('scholar') || a.includes('apprentice')) return true;
  return false;
}

function pillFor(outcome: EngineLineOutcome): string {
  switch (outcome) {
    case 'hit':
    case 'enemy-hit':
      return 'Hit';
    case 'critical':
      return 'Critical';
    case 'miss':
    case 'enemy-miss':
      return 'Miss';
    case 'pass':
      return 'Pass';
    case 'fail':
      return 'Fail';
    case 'refused':
      return 'Refused';
    case 'saved':
      return 'Saved';
    case 'failed-save':
      return 'Failed save';
    case 'pending':
      return 'Pending';
    case 'move':
      return 'Move';
    case 'info':
    default:
      return 'Info';
  }
}

export function parseEngineLine(
  line: string,
  opts?: { nameFor?: (slug: string) => string | undefined },
): EngineLineModel {
  const raw = line;
  const stripped = stripEnginePrefix(line);
  const optsObj = opts;

  // Movement detection
  const isMove =
    /movement_only|no attack was rolled|moved \d|could not move|could not reach|dashed|dodged|disengaged|fled|yielded|withdrew|moved to/i.test(
      stripped,
    );

  // Pending detection
  const isPending = /pending/i.test(stripped) && !isMove;

  // Attack parse
  const attackMatch = stripped.match(/^(.+?)\s+rolled\s+.*?\s+against\s+(.+?)\s+with\s+(.+?)\s+—/i);
  const spellMatch = stripped.match(/^(.+?)\s+cast\s+(.+?)\s+at\s+(.+?)\s+—/i);
  const checkMatch = stripped.match(/^([A-Za-z][A-Za-z ]*?):\s/);
  const refusedSpellMatch = stripped.match(/spell\s+"(.+?)"\s+was refused/i);

  let actorSide: 'player' | 'npc' = 'player';
  let kicker = 'Rules engine';
  let outcome: EngineLineOutcome = 'info';

  // Refused
  if (/was refused/i.test(stripped)) {
    outcome = 'refused';
    if (refusedSpellMatch)
      kicker = `Rules engine · ${nameForSlug(refusedSpellMatch[1].trim(), optsObj)}${refusedSpellMatch[1].toLowerCase().includes('check') ? '' : ''}`;
    // ensure spell kicker
    if (refusedSpellMatch)
      kicker = `Rules engine · ${nameForSlug(refusedSpellMatch[1].trim(), optsObj)}`;
  } else if (isMove) {
    outcome = 'move';
    kicker = 'Rules engine';
  } else if (isPending) {
    outcome = 'pending';
    kicker = 'Rules engine';
  } else {
    // Save spell detection
    const saveMatch = stripped.match(/save\s+(\d+)\s+vs\s+DC\s+(\d+)/i);
    const outcomeWordMatch = stripped.match(/—\s*(PASS|FAIL)\b/i);
    const isSave = Boolean(saveMatch);

    if (isSave) {
      const word = outcomeWordMatch ? outcomeWordMatch[1].toUpperCase() : '';
      const actor = spellMatch ? spellMatch[1].trim() : stripped.split(/\s/)[0];
      const playerCasts = isPlayerActor(actor);
      if (word === 'PASS') {
        outcome = playerCasts ? 'saved' : 'pass';
      } else if (word === 'FAIL') {
        outcome = playerCasts ? 'failed-save' : 'fail';
      }
      if (spellMatch) {
        kicker = `Rules engine · ${nameForSlug(spellMatch[2].trim(), optsObj)}`;
      }
    } else if (attackMatch) {
      const actor = attackMatch[1].trim();
      const target = attackMatch[2].trim();
      const weapon = attackMatch[3].trim();
      const enemy = isPlayerTarget(target);
      actorSide = enemy ? 'npc' : 'player';
      kicker = enemy
        ? `Rules engine · ${nameForSlug(actor, optsObj)} attacks you`
        : `Rules engine · your ${nameForSlug(weapon, optsObj)} attack`;

      const critical = /critical/i.test(stripped);
      const miss = /\bmiss\b/i.test(stripped);
      const hit = /\bhit\b/i.test(stripped) && !miss;
      if (critical && hit) outcome = 'critical';
      else if (hit) outcome = enemy ? 'enemy-hit' : 'hit';
      else if (miss) outcome = enemy ? 'enemy-miss' : 'miss';
      else outcome = 'info';
    } else if (spellMatch) {
      const spell = spellMatch[2].trim();
      kicker = `Rules engine · ${nameForSlug(spell, optsObj)}`;
      const critical = /critical/i.test(stripped);
      const miss = /\bmiss\b/i.test(stripped);
      const hit = /\bhit\b/i.test(stripped) && !miss;
      const autoHit = /auto-hit/i.test(stripped);
      if (critical && hit) outcome = 'critical';
      else if (hit || autoHit) outcome = 'hit';
      else if (miss) outcome = 'miss';
      else outcome = 'info';
    } else if (checkMatch && !attackMatch && !spellMatch) {
      kicker = `Rules engine · ${nameForSlug(checkMatch[1].trim(), optsObj)} check`;
      if (/success/i.test(stripped) || /\bpass\b/i.test(stripped)) outcome = 'pass';
      else if (/fail/i.test(stripped)) outcome = 'fail';
      else outcome = 'info';
    } else if (/initiative/i.test(stripped)) {
      kicker = 'Rules engine · initiative';
      outcome = 'info';
    } else {
      // outcome from keywords
      if (/critical/i.test(stripped)) outcome = 'critical';
      else if (/\bhit\b/i.test(stripped)) outcome = 'hit';
      else if (/miss/i.test(stripped)) outcome = 'miss';
      else if (/success/i.test(stripped) || /\bpass\b/i.test(stripped)) outcome = 'pass';
      else if (/fail/i.test(stripped)) outcome = 'fail';
      else outcome = 'info';
    }
  }

  // actorSide for enemy attacks already set; for save spells where enemy casts? keep player default
  if (outcome === 'enemy-hit' || outcome === 'enemy-miss') actorSide = 'npc';

  // badge
  let badge = '?';
  if (isMove) {
    badge = '→';
  } else {
    const patterns = [
      /rolled\s+(\d+)/i,
      /spell attack\s+(\d+)/i,
      /nat\s+(\d+)/i,
      /save\s+(\d+)/i,
      /:\s*(\d+)\s*\(/i,
      /\b(\d+)\s*\+\s*-?\d+\s*=\s*\d+/,
    ];
    for (const p of patterns) {
      const m = stripped.match(p);
      if (m && m[1]) {
        badge = m[1];
        break;
      }
    }
    if (badge === '?' && isPending) badge = '?';
  }

  // math
  const mathMatch = stripped.match(/(\d+)\s*\+\s*(-?\d+)\s*=\s*(\d+)/);
  const math = mathMatch ? `${mathMatch[1]} + ${mathMatch[2]} = ${mathMatch[3]}` : null;

  // detail
  let detailCandidate = stripped;
  if (math) {
    const vsIdx = detailCandidate.toLowerCase().indexOf(' vs ');
    const dashIdx = detailCandidate.indexOf('—');
    if (vsIdx !== -1) {
      detailCandidate = detailCandidate.slice(vsIdx).trim();
    } else if (dashIdx !== -1) {
      detailCandidate = detailCandidate.slice(dashIdx).trim();
    }
  }
  const detail = replaceEnemyHp(replaceSlugs(detailCandidate, optsObj));

  const pill = pillFor(outcome);

  // kicker slug replacement
  kicker = replaceSlugs(kicker, optsObj);

  return {
    badge,
    actorSide,
    kicker,
    math,
    detail: detail || null,
    outcome,
    pill,
    raw,
  };
}

export function engineLineModelFromCheck(check: EngineLineCheckContext): EngineLineModel {
  const outcomeRaw = String(check.outcome ?? '').toLowerCase();
  let outcome: EngineLineOutcome = 'info';
  if (outcomeRaw.includes('pass') || outcomeRaw === 'success' || outcomeRaw === 'true')
    outcome = 'pass';
  else if (outcomeRaw.includes('fail') || outcomeRaw === 'false') outcome = 'fail';
  else outcome = 'info';

  const pill = outcome === 'pass' ? 'Pass' : outcome === 'fail' ? 'Fail' : 'Info';
  const badge = String(check.die);
  const math = `${check.die} + ${check.modifier} = ${check.total}`;
  // avoid double "check" if label already ends with check
  const cleanKicker = check.label.toLowerCase().endsWith('check')
    ? `Rules engine · ${nameForSlug(check.label, undefined)}`
    : `Rules engine · ${nameForSlug(check.label, undefined)} check`;

  const raw = `⚙️ Engine: ${check.label}: ${check.die} + ${check.modifier} = ${check.total} vs DC ${check.dc} — ${check.outcome}.`;

  return {
    badge,
    actorSide: 'player',
    kicker: replaceSlugs(cleanKicker, undefined),
    math,
    detail: `vs DC ${check.dc}`,
    outcome,
    pill,
    raw,
  };
}

// export helper for raw humanization
export { humanizeEngineLine as humanizeRawEngineLine };
