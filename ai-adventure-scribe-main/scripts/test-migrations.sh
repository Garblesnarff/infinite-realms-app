#!/usr/bin/env bash
# =============================================================================
# Migration Replay Test
# =============================================================================
# Replays this repo's migration history into a throwaway PostgreSQL database
# and asserts the resulting schema is the one db/schema/*.ts expects.
#
# Purpose: catch a broken or conflicting migration *before* it is applied to
# production. Together with scripts/check-schema-drift.sh (which catches
# schema.ts edits that ship without a migration) this closes the loop that
# produced three schema-drift incidents -- most recently 20260725, where
# combat_participant_status.exhaustion_level and eleven whole tables existed in
# db/schema/*.ts but in no migration and no production database (17ebfd47).
#
# Usage:
#   bun run test:migrations
#   TEST_DATABASE_URL=postgres://user:pass@host:5432/postgres bun run test:migrations
#
# Requirements: psql on PATH and a reachable PostgreSQL server. Nothing else --
# the previous version of this script required the Supabase CLI and called
# `supabase db exec`, which is not a command in any current Supabase CLI, so it
# could not have passed since it was written. It also pointed at
# supabase/migrations/ rather than db/migrations/, where every migration since
# 2025-11 actually lives.
#
# =============================================================================
# Replay order
# =============================================================================
# The history is genuinely split across two directories and is NOT simply
# "db/migrations sorted by name". Verified empirically by replaying into a
# scratch database:
#
#   * db/migrations/0000_early_darkstar.sql + 0001_parched_rictor.sql are a
#     drizzle-kit *introspection baseline* taken on 2025-11-05. They CREATE the
#     core tables (campaigns, characters, game_sessions, memories, ...) that no
#     file in supabase/migrations/ ever creates -- those were made through the
#     Supabase dashboard. So the baseline must run first, and every
#     supabase/migrations file older than it is already contained in it.
#
#   * supabase/migrations files NEWER than the baseline are still load-bearing:
#     combat_encounters, combat_participants, combat_participant_status,
#     character_equipment, ai_usage and character_creation_metrics are all
#     created there (20251112_*, 20251114_*), and later db/migrations files
#     ALTER them. Replaying db/migrations alone fails on six "relation does not
#     exist" errors.
#
#   * From the baseline onward the two directories interleave by date, so they
#     are merged and sorted by filename.
#
# The two drizzle index-prefixed files that are not date-named get an explicit
# sort key (see ORDER_OVERRIDES) because "0001_..." would otherwise sort before
# every date-named migration it depends on.
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

DB_MIGRATIONS_DIR="$PROJECT_ROOT/db/migrations"
SUPABASE_MIGRATIONS_DIR="$PROJECT_ROOT/supabase/migrations"
KNOWN_GAPS_FILE="$DB_MIGRATIONS_DIR/.replay-known-gaps"

# supabase/migrations files at or after this basename post-date the drizzle
# introspection baseline and must still be replayed. Everything older is
# already baked into 0001_parched_rictor.sql.
BASELINE_CUTOFF="20251103151855"

ADMIN_URL="${TEST_DATABASE_URL:-postgres://localhost:5432/postgres}"
TEST_DB_NAME="test_migrations_$$_$(date +%s)"
SCRATCH_DUMP="$(mktemp "${TMPDIR:-/tmp}/replay-columns.XXXXXX")"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
CYAN=$'\033[0;36m'
NC=$'\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0
MIGRATIONS_APPLIED=0
MIGRATIONS_SKIPPED=0
# Skips forced by a missing pgvector extension, counted separately: they make
# some columns unreachable, so schema-completeness findings become advisory
# rather than failures caused by the developer's environment.
MIGRATIONS_SKIPPED_PGVECTOR=0

log_info()    { echo "${CYAN}ℹ${NC} $1"; }
log_success() { echo "${GREEN}✓${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
log_error()   { echo "${RED}✗${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
log_warning() { echo "${YELLOW}⚠${NC} $1"; }
log_section() {
  echo ""
  echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo "${BLUE}$1${NC}"
  echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Derive a connection URL for the scratch database from the admin URL by
# swapping the path component.
test_db_url() {
  local base="${ADMIN_URL%%\?*}"
  local query=""
  [ "$base" != "$ADMIN_URL" ] && query="?${ADMIN_URL#*\?}"
  echo "${base%/*}/${TEST_DB_NAME}${query}"
}

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 "$ADMIN_URL" "$@"; }
psql_test()  { psql -X -q -v ON_ERROR_STOP=1 "$(test_db_url)" "$@"; }
# Single-value query, whitespace-trimmed.
query_value() {
  psql -X -A -t -q "$(test_db_url)" -c "$1" 2>/dev/null | head -1 | tr -d '[:space:]'
}

# Always drop the scratch database, including on failure -- keep KEEP_TEST_DB=1
# set to leave it behind for post-mortem inspection.
cleanup() {
  rm -f "$SCRATCH_DUMP"
  if [ -z "${KEEP_TEST_DB:-}" ]; then
    psql -X -q "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$TEST_DB_NAME\";" >/dev/null 2>&1
  else
    echo "${YELLOW}⚠${NC} KEEP_TEST_DB set -- left database $TEST_DB_NAME in place"
  fi
}
trap cleanup EXIT

# =============================================================================
# Pre-flight
# =============================================================================
preflight_checks() {
  log_section "Pre-flight Checks"

  if ! command -v psql >/dev/null 2>&1; then
    echo "${RED}✗${NC} psql not found. Install PostgreSQL client tools." >&2
    exit 1
  fi
  log_info "psql: $(psql --version)"

  if ! psql -X -q "$ADMIN_URL" -c 'SELECT 1' >/dev/null 2>&1; then
    echo "${RED}✗${NC} Cannot connect to $ADMIN_URL" >&2
    echo "    Set TEST_DATABASE_URL to a reachable PostgreSQL maintenance database." >&2
    exit 1
  fi
  log_success "Connected to PostgreSQL"

  for dir in "$DB_MIGRATIONS_DIR" "$SUPABASE_MIGRATIONS_DIR"; do
    if [ ! -d "$dir" ]; then
      echo "${RED}✗${NC} Missing migrations directory: $dir" >&2
      exit 1
    fi
  done
  log_success "Migration directories present"
}

# =============================================================================
# Replay list
# =============================================================================
# Emits "<sortkey>\t<path>" lines. ORDER_OVERRIDES maps the drizzle
# index-prefixed filenames onto the date timeline they actually belong to.
build_replay_list() {
  {
    # Introspection baseline -- creates the core Supabase-era tables.
    echo "00000000_000000_0000	$DB_MIGRATIONS_DIR/0000_early_darkstar.sql"
    echo "00000000_000000_0001	$DB_MIGRATIONS_DIR/0001_parched_rictor.sql"

    for f in "$SUPABASE_MIGRATIONS_DIR"/*.sql; do
      [ -e "$f" ] || continue
      base="$(basename "$f")"
      case "$base" in
        *.backup) continue;;
        # 20251103_0N_* are chronologically older than 20251103151855 despite
        # sorting after it ('_' > '1'), so they are pre-baseline too.
        20251103_0*) continue;;
      esac
      # Older than the baseline: already contained in 0001_parched_rictor.sql.
      [[ "$base" < "$BASELINE_CUTOFF" ]] && continue
      echo "$base	$f"
    done

    for f in "$DB_MIGRATIONS_DIR"/*.sql; do
      [ -e "$f" ] || continue
      base="$(basename "$f")"
      case "$base" in
        0000_early_darkstar.sql|0001_parched_rictor.sql) continue;;
        # Indexes dialogue_history(sequence_number), which is added by
        # supabase/migrations/20251103151855_add_message_sequence_numbers.sql.
        0001_add_session_indexes.sql) echo "20251110_000000	$f"; continue;;
        # ALTERs combat_participants, which is created by
        # supabase/migrations/20251112_01_add_combat_system_unified.sql. Its drizzle index
        # prefix would sort it before every date-named migration, so it would replay against
        # a database with no combat tables in it yet.
        0005_happy_shadow_king.sql) echo "20260726_000000	$f"; continue;;
        # ALTERs combat_encounters, created by supabase/migrations/20251112_01_*. Same reason
        # as 0005 above: a bare drizzle index prefix sorts before every date-named migration,
        # so without this it replays against a database with no combat tables yet.
        0006_record_why_an_encounter_ended.sql) echo "20260727_000000	$f"; continue;;
        # Deliberate no-op snapshot re-baseline; safe anywhere, pinned last.
        0004_schema_baseline.sql) echo "99999999_999999	$f"; continue;;
      esac
      echo "$base	$f"
    done
  } | sort | cut -f2
}

# =============================================================================
# Scratch database
# =============================================================================
# Creates the objects Supabase provides out of the band of migrations: the
# auth/admin schemas, the anon/authenticated/service_role roles that GRANT and
# RLS statements reference, and the extensions.
create_test_database() {
  log_section "Creating Scratch Database"

  psql_admin -c "DROP DATABASE IF EXISTS \"$TEST_DB_NAME\";" >/dev/null 2>&1
  if ! psql_admin -c "CREATE DATABASE \"$TEST_DB_NAME\";" >/dev/null 2>&1; then
    echo "${RED}✗${NC} Could not create database $TEST_DB_NAME" >&2
    exit 1
  fi
  log_success "Created database: $TEST_DB_NAME"

  psql_test <<'SQL' >/dev/null 2>&1
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS admin;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Minimal stubs for the GoTrue objects that RLS policies and FKs reference.
-- Enough for the DDL to resolve; not an auth implementation.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
SQL
  log_success "Bootstrapped Supabase-provided schemas, roles and extensions"

  if psql -X -q "$(test_db_url)" -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null 2>&1; then
    HAS_PGVECTOR=1
    log_success "pgvector available"
  else
    HAS_PGVECTOR=0
    log_warning "pgvector NOT available -- embedding migrations will be SKIPPED, not tested."
    log_warning "CI runs on the pgvector/pgvector image, where they are exercised."
  fi
}

# =============================================================================
# Replay
# =============================================================================
is_known_gap() {
  [ -f "$KNOWN_GAPS_FILE" ] || return 1
  grep -v '^[[:space:]]*#' "$KNOWN_GAPS_FILE" \
    | grep -v '^[[:space:]]*$' \
    | grep -qxF "$1"
}

run_migrations() {
  log_section "Replaying Migrations"

  local failed_files=()
  local known_gap_hits=()
  local unexpectedly_passing=()

  while IFS= read -r migration; do
    [ -n "$migration" ] || continue
    local base rel
    base="$(basename "$migration")"
    rel="${migration#"$PROJECT_ROOT"/}"

    # A migration may declare that it handles a missing pgvector itself (by
    # guarding the vector DDL on pg_extension), in which case it must still be
    # applied -- skipping a file that also creates unrelated tables cascades
    # into failures for every later migration that depends on them.
    if [ "$HAS_PGVECTOR" -eq 0 ] \
       && ! grep -q 'replay:requires-no-pgvector' "$migration" \
       && grep -qiE 'vector\(|\bvector\b *[,)]|USING (ivfflat|hnsw)' "$migration"; then
      log_warning "SKIP (needs pgvector): $rel"
      MIGRATIONS_SKIPPED=$((MIGRATIONS_SKIPPED + 1))
      MIGRATIONS_SKIPPED_PGVECTOR=$((MIGRATIONS_SKIPPED_PGVECTOR + 1))
      continue
    fi

    local out
    if out="$(psql -X -q -v ON_ERROR_STOP=1 "$(test_db_url)" -f "$migration" 2>&1)"; then
      MIGRATIONS_APPLIED=$((MIGRATIONS_APPLIED + 1))
      [ -n "${VERBOSE:-}" ] && log_info "applied: $rel"
      if is_known_gap "$rel"; then
        unexpectedly_passing+=("$rel")
      fi
    elif is_known_gap "$rel"; then
      # Pre-existing history gap -- see db/migrations/.replay-known-gaps.
      log_warning "KNOWN GAP: $rel"
      known_gap_hits+=("$rel")
      MIGRATIONS_SKIPPED=$((MIGRATIONS_SKIPPED + 1))
    else
      log_error "MIGRATION FAILED: $rel"
      echo "$out" | grep -E 'ERROR|FATAL' | head -3 | sed 's/^/      /'
      failed_files+=("$rel")
    fi
  done < <(build_replay_list)

  echo ""
  log_info "Applied: $MIGRATIONS_APPLIED   Skipped/known-gap: $MIGRATIONS_SKIPPED   Failed: ${#failed_files[@]}"

  if [ ${#unexpectedly_passing[@]} -gt 0 ]; then
    echo ""
    log_info "These are listed in db/migrations/.replay-known-gaps but now replay cleanly."
    log_info "Remove them from that file:"
    printf '      %s\n' "${unexpectedly_passing[@]}"
  fi

  if [ ${#failed_files[@]} -gt 0 ]; then
    echo ""
    echo "${RED}The migration history no longer replays cleanly.${NC}"
    echo "A migration that cannot be replayed cannot be trusted against production."
    echo ""
    echo "Do NOT add these to db/migrations/.replay-known-gaps -- that file is a"
    echo "frozen record of pre-existing debt and only ever shrinks. Fix the migration,"
    echo "or write the missing migration it depends on."
    return 1
  fi
  return 0
}

# =============================================================================
# Schema assertions
# =============================================================================
assert_table() {
  local table="$1"
  if [ "$(query_value "SELECT to_regclass('public.$table') IS NOT NULL;")" = "t" ]; then
    log_success "table exists: $table"
  else
    log_error "table MISSING: $table"
  fi
}

assert_column() {
  local table="$1" column="$2" expected_type="${3:-}"
  local actual
  actual="$(query_value "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='$table' AND column_name='$column';")"
  if [ -z "$actual" ]; then
    log_error "column MISSING: $table.$column"
  elif [ -n "$expected_type" ] && [ "$actual" != "$expected_type" ]; then
    log_error "column type mismatch: $table.$column is '$actual', expected '$expected_type'"
  else
    log_success "column exists: $table.$column${expected_type:+ ($expected_type)}"
  fi
}

# The central assertion: everything db/schema/*.ts declares must be reachable
# by replaying the committed migrations. Driven by the newest snapshot in
# db/migrations/meta/ rather than a hand-maintained list, so it cannot go stale
# as the schema grows -- add a table to db/schema/*.ts without a migration that
# creates it and this fails, whether or not anyone remembered to update a list.
#
# This is what the 20260725 incident needed and did not have: eleven tables and
# combat_participant_status.exhaustion_level lived in db/schema/*.ts with no
# migration behind them, and nothing compared the two until production 500'd.
validate_schema_matches_drizzle() {
  log_section "Replayed Schema vs db/schema/*.ts"

  local snapshot
  snapshot="$(find "$DB_MIGRATIONS_DIR/meta" -name '[0-9]*_snapshot.json' | sort | tail -1)"
  if [ -z "$snapshot" ]; then
    log_error "no drizzle snapshot found in $DB_MIGRATIONS_DIR/meta"
    return
  fi

  local dump="$SCRATCH_DUMP"
  psql -X -A -t -q "$(test_db_url)" \
    -c "SELECT table_name||'|'||column_name FROM information_schema.columns WHERE table_schema='public';" \
    >"$dump" 2>/dev/null

  local result
  result="$(SNAPSHOT="$snapshot" DUMP="$dump" node -e '
    const fs = require("fs");
    const snap = JSON.parse(fs.readFileSync(process.env.SNAPSHOT, "utf8"));
    const have = {};
    for (const line of fs.readFileSync(process.env.DUMP, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const [t, c] = line.split("|");
      (have[t] = have[t] || []).push(c);
    }
    const missingTables = [], missingColumns = [];
    for (const t of Object.values(snap.tables)) {
      if (!have[t.name]) { missingTables.push(t.name); continue; }
      for (const c of Object.keys(t.columns)) {
        if (!have[t.name].includes(c)) missingColumns.push(t.name + "." + c);
      }
    }
    console.log(JSON.stringify({
      tableCount: Object.keys(snap.tables).length,
      missingTables, missingColumns,
    }));
  ' 2>/dev/null)"

  if [ -z "$result" ]; then
    log_error "could not compare replayed schema against $snapshot (is node available?)"
    return
  fi

  local n_tables missing_t missing_c
  n_tables="$(echo "$result" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tableCount))')"
  missing_t="$(echo "$result" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).missingTables.join(" ")))')"
  missing_c="$(echo "$result" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).missingColumns.join(" ")))')"

  # Migrations skipped for want of pgvector cannot create their objects, so a
  # "missing" finding then says nothing about the migration history -- it says
  # the developer's PostgreSQL lacks an extension. Report it, but do not fail.
  # CI runs on the pgvector image, where nothing is skipped and this is strict.
  local report=log_error
  if [ "$MIGRATIONS_SKIPPED_PGVECTOR" -gt 0 ]; then
    report=log_warning
  fi

  if [ -z "$missing_t" ]; then
    log_success "all $n_tables tables in $(basename "$snapshot") exist after replay"
  else
    $report "tables in db/schema/*.ts that no migration creates:"
    for t in $missing_t; do echo "      $t"; done
  fi

  if [ -z "$missing_c" ]; then
    log_success "all columns in $(basename "$snapshot") exist after replay"
  else
    $report "columns in db/schema/*.ts that no migration creates:"
    for c in $missing_c; do echo "      $c"; done
  fi

  if [ "$report" = "log_warning" ] && { [ -n "$missing_t" ] || [ -n "$missing_c" ]; }; then
    log_warning "^ warnings, not failures: $MIGRATIONS_SKIPPED_PGVECTOR migration(s) were skipped"
    log_warning "  because pgvector is not installed. Install it, or run against a"
    log_warning "  pgvector-capable server, for a conclusive result."
  fi
}

validate_schema() {
  validate_schema_matches_drizzle

  log_section "Targeted Incident Assertions"

  # The exact column whose absence 500'd every POST /v1/combat/sessions/:id/start.
  assert_column combat_participant_status exhaustion_level integer
  # Inverse drift from the 20260710 fix: prod was migrated to jsonb, schema.ts
  # was not updated to match until 17ebfd47.
  assert_column character_equipment magic_effects jsonb
  # Proves 20260710_align_character_equipment.sql actually did its conversion
  # during replay rather than being skipped: the backfill creates this column
  # as text[], that migration turns it into text.
  assert_column character_equipment magic_properties text
  assert_column characters class_levels jsonb
  assert_column tokens created_by uuid
  assert_column combat_encounters current_round integer
  assert_column character_spell_slots spell_level integer
}

validate_constraints() {
  log_section "Constraint & Index Validation"

  local fk_count
  fk_count="$(query_value "SELECT count(*) FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name='combat_participants' AND kcu.column_name='encounter_id';")"
  if [ "${fk_count:-0}" -ge 1 ]; then
    log_success "FK: combat_participants.encounter_id -> combat_encounters.id"
  else
    log_error "FK MISSING: combat_participants.encounter_id"
  fi

  local idx_count
  idx_count="$(query_value "SELECT count(*) FROM pg_indexes WHERE tablename='combat_participants' AND indexdef LIKE '%encounter_id%';")"
  if [ "${idx_count:-0}" -ge 1 ]; then
    log_success "index on combat_participants.encounter_id"
  else
    log_error "index MISSING on combat_participants.encounter_id"
  fi

  local active_session_idx_count
  active_session_idx_count="$(query_value "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='combat_encounters' AND indexname='idx_combat_encounters_one_active_session' AND indexdef ILIKE '%UNIQUE INDEX%' AND indexdef ILIKE '%WHERE%status%active%';")"
  if [ "${active_session_idx_count:-0}" -eq 1 ]; then
    log_success "partial unique index: one active combat encounter per session"
  else
    log_error "partial unique index MISSING: combat_encounters(session_id) WHERE status='active'"
  fi
}

# The regression test for the incident itself: the INSERT pulled from the
# production logs that failed with
#   column "exhaustion_level" of relation "combat_participant_status" does not exist
# Run inside a rolled-back transaction so the scratch schema is untouched.
test_combat_start_insert() {
  log_section "Regression: combat-start INSERT (20260725 incident)"

  local out
  out="$(psql -X -q "$(test_db_url)" -v ON_ERROR_STOP=1 <<'SQL' 2>&1
BEGIN;
INSERT INTO campaigns (id, user_id, name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'user_replaytest', 'Replay Test')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO game_sessions (id, campaign_id) VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO combat_encounters (id, session_id, status)
  VALUES ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'active');
INSERT INTO combat_participants (id, encounter_id, name, participant_type, initiative, turn_order, armor_class, max_hp)
  VALUES ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2', 'Goblin', 'enemy', 15, 0, 14, 7);
INSERT INTO combat_participant_status
  (participant_id, current_hp, max_hp, temp_hp, death_saves_successes, death_saves_failures, exhaustion_level)
  VALUES ('00000000-0000-0000-0000-0000000000e3', 7, 7, 0, 0, 0, 0);
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ]; then
    log_success "combat-start INSERT succeeds (exhaustion_level present)"
  else
    log_error "combat-start INSERT failed -- this is the 20260725 incident recurring"
    echo "$out" | grep -E 'ERROR|FATAL' | head -3 | sed 's/^/      /'
  fi
}

print_summary() {
  log_section "Summary"
  echo ""
  echo "Migrations applied: $MIGRATIONS_APPLIED"
  echo "Migrations skipped: $MIGRATIONS_SKIPPED"
  echo "Assertions passed:  ${GREEN}$TESTS_PASSED${NC}"
  echo "Assertions failed:  ${RED}$TESTS_FAILED${NC}"
  echo ""
  if [ "$TESTS_FAILED" -eq 0 ]; then
    echo "${GREEN}ALL MIGRATION TESTS PASSED ✓${NC}"
    return 0
  fi
  echo "${RED}MIGRATION TESTS FAILED${NC}"
  return 1
}

main() {
  echo ""
  echo "${BLUE}╔════════════════════════════════════════════╗${NC}"
  echo "${BLUE}║   MIGRATION REPLAY TEST                    ║${NC}"
  echo "${BLUE}╚════════════════════════════════════════════╝${NC}"

  preflight_checks
  create_test_database

  if ! run_migrations; then
    print_summary
    exit 1
  fi

  validate_schema
  validate_constraints
  test_combat_start_insert

  print_summary
  exit $?
}

main "$@"
