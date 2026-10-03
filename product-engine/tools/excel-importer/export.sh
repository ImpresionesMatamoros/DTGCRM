#!/usr/bin/env bash
# Export ImportEnvelope v1 files from the real workbooks (read-only).
#   DTG_SOURCES=/path/to/workbooks bash tools/excel-importer/export.sh            → .import/envelopes/
#   DTG_SOURCES=/path/to/workbooks bash tools/excel-importer/export.sh --fixtures → tests/fixtures/import/
set -euo pipefail
: "${DTG_SOURCES:?Set DTG_SOURCES to the directory holding the five source workbooks}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCES="$(cd "$DTG_SOURCES" && pwd)"
cd "$ROOT/tools/excel-importer"
export PYTHONUTF8=1
if [[ "${1:-}" == "--fixtures" ]]; then
  # Committed controlled subset (FIXTURE data class). Flyers and the traditional card are
  # left out of Git only for size; they can be regenerated with --only.
  python3 -m interchange --sources "$SOURCES" --output "$ROOT/tests/fixtures/import" --fixtures \
    --only "${FIXTURE_ONLY:-premium-business-card,magnets,x-banner,cotton-t-shirt,dtf-transfer,yard-sign}"
  python3 -m interchange.price_evidence --sources "$SOURCES" \
    --output "$ROOT/tests/fixtures/import/real-price-evidence.v1_2.json"
else
  python3 -m interchange --sources "$SOURCES" --output "$ROOT/.import/envelopes"
fi
