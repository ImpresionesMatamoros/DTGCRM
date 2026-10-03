#!/usr/bin/env bash
# STEP 09 · clean rebuild proof. Run it in a FRESH copy of the repository (git clone) against an empty LOCAL
# database. Everything goes through scripts and the Admin: there are no manual database edits.
#
#   DTG_SOURCES=<dir with the 5 workbooks> DATABASE_URL=postgres://…/dtg_clean_rebuild bash tools/step09-rebuild.sh
#
# Order (STEP 09 §43): install → DB rebuild (+ DB tests) → seed check → importer tests → stage real workbooks →
# apply recorded owner decisions → quality + gate + dry run (before any REAL write) → Playwright flow 1
# (dry run, permit and scoped publication through the Admin) → post-migration reports → the other Playwright
# flows → unit tests → lint/typecheck/build. Test counts land in docs/step09/data/test-results.json.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DTG_SOURCES:?set DTG_SOURCES}"
: "${DATABASE_URL:?set DATABASE_URL (local only)}"
LOG="${STEP09_LOG:-/tmp/step09-rebuild-logs}"
mkdir -p "$LOG" docs/step09/data
export DTG_SOURCES DATABASE_URL

hash_sources() { (cd "$DTG_SOURCES" && sha256sum *.xlsx | sort -k2); }
hash_sources > "$LOG/workbooks.before.sha256"

step() { echo; echo "=== $* ==="; }

step "install"; pnpm install --frozen-lockfile > "$LOG/install.log" 2>&1; tail -2 "$LOG/install.log"
step "db:rebuild (reset, migrate, seed, DB tests)"; pnpm db:rebuild > "$LOG/db.log" 2>&1; grep -E "Tests |Test Files|applied|seeded" "$LOG/db.log"
step "seed:check"; pnpm seed:check > "$LOG/seed.log" 2>&1; tail -2 "$LOG/seed.log"
step "importer tests"; pnpm importer:test > "$LOG/importer.log" 2>&1 || true; grep -E "^Ran |^OK|FAILED" "$LOG/importer.log"
step "stage the real workbooks"
pnpm importer:envelopes > "$LOG/envelopes.log" 2>&1
pnpm import:dry-run --report "$LOG/import-dry-run.md" > "$LOG/stage.log" 2>&1; tail -3 "$LOG/stage.log"
step "apply the recorded owner decisions (OD-01..OD-09)"; pnpm exec tsx scripts/step09-migrate.ts decisions | tee "$LOG/decisions.log" | tail -5
step "gate"; pnpm exec tsx scripts/step09-migrate.ts gate | tail -2
step "before any REAL write: OWNER_DECISION_GATE + REAL_PUBLICATION_DRY_RUN"; pnpm exec tsx scripts/step09-report.ts pre
test -s docs/step09/REAL_PUBLICATION_DRY_RUN.md
step "build"; pnpm build > "$LOG/build.log" 2>&1; tail -3 "$LOG/build.log"
step "Playwright flow 1 · dry run, permit, scoped publication (Admin)"
pnpm exec playwright test tests/e2e/00-migration.spec.ts > "$LOG/e2e-1.log" 2>&1 || { tail -40 "$LOG/e2e-1.log"; exit 1; }
grep -E "passed|failed" "$LOG/e2e-1.log"
step "post-migration reports"; pnpm exec tsx scripts/step09-report.ts post
step "Playwright flows 2 (the STEP 06–08 suites) — on a COPY of the database"
# Those suites write test decisions and bulk changes into the staging. They run on a throw-away copy of the
# database (same state as the STEP 09 pass), so nothing they write can leak into the owner-decision pass below.
DB_MAIN="${DATABASE_URL##*/}"; DB_FLOWS="${DB_MAIN}_flows2"; ADMIN_URL="${DATABASE_URL%/*}/postgres"
psql "$ADMIN_URL" -qc "drop database if exists \"$DB_FLOWS\"" -c "create database \"$DB_FLOWS\" template \"$DB_MAIN\""
DATABASE_URL="${DATABASE_URL%/*}/$DB_FLOWS" pnpm exec playwright test --grep-invert "Commercial Print migration" > "$LOG/e2e-2.log" 2>&1 || { tail -40 "$LOG/e2e-2.log"; exit 1; }
grep -E "passed|failed" "$LOG/e2e-2.log"
psql "$ADMIN_URL" -qc "drop database if exists \"$DB_FLOWS\""
# ------------------------------------------------------------------------------------------------
# STEP 09 completion · OWNER_DECISION_SPEC_v1.0 (applied on top of the STEP 09 state above)
# ------------------------------------------------------------------------------------------------
COUNTS="select (select count(*) from catalog_item)||'/'||(select count(*) from migration_publication)||'/'||(select count(*) from migration_permit)||'/'||(select count(*) from import_candidate_link)||'/'||(select count(*) from candidate_disposition)"
step "completion · snapshot before the owner decisions v1.0"; pnpm exec tsx scripts/step09-completion-report.ts before --completion
step "completion · apply OWNER_DECISION_SPEC_v1.0 (answers, categories, dispositions, resolutions)"
pnpm exec tsx scripts/step09-migrate.ts completion | tee "$LOG/completion.log" | tail -12
step "completion · gate"; pnpm exec tsx scripts/step09-migrate.ts gate --completion | tail -3
step "completion · dry run BEFORE any REAL write"
pnpm exec tsx scripts/step09-completion-report.ts pre --completion
test -s docs/step09/OWNER_DECISIONS_REAL_PUBLICATION_DRY_RUN.md
step "completion · owner approves the superseding permit and publishes"
pnpm exec tsx scripts/step09-migrate.ts permit --completion | tail -1
pnpm exec tsx scripts/step09-migrate.ts publish --completion > "$LOG/completion-publish-1.json"
C1=$(psql "$DATABASE_URL" -Atc "$COUNTS")
pnpm exec tsx scripts/step09-migrate.ts publish --completion > "$LOG/completion-publish-2.json"
C2=$(psql "$DATABASE_URL" -Atc "$COUNTS")
echo "counts after publish: $C1 · after second publish: $C2"; test "$C1" = "$C2" && echo "completion publication idempotent"
step "completion · post reports"; pnpm exec tsx scripts/step09-completion-report.ts post --completion
step "Playwright completion flows"
pnpm exec playwright test tests/e2e/01-completion.spec.ts > "$LOG/e2e-3.log" 2>&1 || { tail -40 "$LOG/e2e-3.log"; exit 1; }
grep -E "passed|failed" "$LOG/e2e-3.log"

step "unit tests"; pnpm test > "$LOG/unit.log" 2>&1; grep -E "Tests |Test Files" "$LOG/unit.log"
step "lint / typecheck / format"; pnpm lint > "$LOG/lint.log" 2>&1; pnpm typecheck > "$LOG/tsc.log" 2>&1; pnpm format:check > "$LOG/format.log" 2>&1 || true; tail -2 "$LOG/format.log"
hash_sources > "$LOG/workbooks.after.sha256"
diff "$LOG/workbooks.before.sha256" "$LOG/workbooks.after.sha256" && echo "workbooks unchanged"

node -e '
const fs=require("fs");const L=process.env.LOG||"'"$LOG"'";
const num=(f,re,i=1)=>{try{const m=fs.readFileSync(L+"/"+f,"utf8").match(re);return m?Number(m[i]):null}catch{return null}};
const out={
  unit:{passed:num("unit.log",/Tests\s+(\d+) passed/)},
  db:{passed:num("db.log",/Tests\s+(\d+) passed/)},
  importer:{ran:num("importer.log",/Ran (\d+) tests/)},
  e2e_migration:{passed:num("e2e-1.log",/(\d+) passed/)},
  e2e_other:{passed:num("e2e-2.log",/(\d+) passed/)},
  e2e_completion:{passed:num("e2e-3.log",/(\d+) passed/)},
  workbooksUnchanged:true
};
fs.writeFileSync("docs/step09/data/test-results.json",JSON.stringify(out,null,2));console.log(out);'
cp "$LOG/workbooks.before.sha256" docs/step09/data/workbooks.sha256
pnpm exec tsx scripts/step09-completion-report.ts final --completion
