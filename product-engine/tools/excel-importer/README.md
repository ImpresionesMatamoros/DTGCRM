# Excel importer (STEP 05A parser + STEP 05B interchange)

Python tool that reads the DTG catalog workbooks **read-only** and emits a neutral, versioned JSON contract (`ImportEnvelope` v1) for the TypeScript import bridge (`src/import`).

```
Excel (read-only) → parser/ (STEP 05A, v0.1.0, unchanged) → interchange/ (STEP 05B) → *.envelope.json → src/import (Zod) → staging
```

| Path                        | Origin   | Notes                                                                                                                                                   |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parser/`                   | STEP 05A | Copied verbatim (Astra Light delivery). Business interpretation is limited to hypotheses; no identities, no publication.                                |
| `tests/test_parser.py`      | STEP 05A | Copied verbatim (27 tests).                                                                                                                             |
| `docs/step05a/`             | STEP 05A | Original documentation and `OUTPUT_SHA256SUMS.txt` (the delivered evidence used CRLF; regenerated evidence is byte-identical after CRLF normalization). |
| `verify_delivery.py`        | STEP 05A | Kept for traceability; it validates the original STEP 05A package layout.                                                                               |
| `interchange/`              | STEP 05B | Serializes a parse result as `ImportEnvelope`; adds presentation evidence candidates; proves no provenance cell is dropped.                             |
| `tests/test_interchange.py` | STEP 05B | 12 tests (7 synthetic, 5 on the real workbooks).                                                                                                        |

## Requirements

Python ≥ 3.11 and `openpyxl==3.1.5` (`python3 -m pip install -r requirements.txt`). The workbooks are **not** in Git; point `DTG_SOURCES` to the directory that holds the five files.

## Commands (from the repository root)

```bash
pnpm importer:test                                   # source-independent tests (CI)
DTG_SOURCES=/path/to/workbooks pnpm importer:test    # full suite: 27 STEP 05A + 12 STEP 05B
DTG_SOURCES=/path/to/workbooks pnpm importer:envelopes            # → .import/envelopes/*.envelope.json
DTG_SOURCES=/path/to/workbooks pnpm importer:envelopes --fixtures # → tests/fixtures/import (controlled subset)
```

The full test run regenerates `evidence/` and `fixtures/` inside this directory first (the STEP 05A tests read them from here). Both are git-ignored and deterministic.

## Guarantees

- Workbooks are hashed before and after every run; any change aborts.
- Same bytes + same parser/exporter version ⇒ identical envelope.
- The envelope carries no Product Engine UUID, public code, publication flag or PostgreSQL-specific value.
- Historical prices travel in `historical_prices`, never in `candidates`.
