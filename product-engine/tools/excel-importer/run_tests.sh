#!/usr/bin/env bash
# STEP 05A parser tests + STEP 05B interchange tests.
# With DTG_SOURCES (directory holding the five workbooks) the full suite runs:
# the deterministic evidence is regenerated first because the STEP 05A tests
# read it from this directory (evidence/, fixtures/ — both git-ignored).
# Without DTG_SOURCES only the tests that need no workbook run (CI).
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
export PYTHONUTF8=1
if [[ -n "${DTG_SOURCES:-}" ]]; then
  "$PY" -m parser.pipeline --sources "$DTG_SOURCES" --output . > /dev/null
  "$PY" -m unittest discover -s tests -v
else
  echo "DTG_SOURCES not set: running source-independent tests only"
  "$PY" -m unittest -v tests.test_parser.NormalizationTests tests.test_interchange.SyntheticEnvelopeTests
fi
