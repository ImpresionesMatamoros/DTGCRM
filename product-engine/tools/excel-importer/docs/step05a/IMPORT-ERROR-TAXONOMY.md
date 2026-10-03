# Import error taxonomy

Stable codes implemented in `parser/validation.py`.

| Code | Severity | Meaning |
|---|---|---|
| IMPORT_MISSING_REQUIRED_SOURCE_VALUE | ERROR | Required source value is absent |
| IMPORT_UNKNOWN_CURRENCY | WARNING | Currency is not supported by explicit evidence |
| IMPORT_CURRENCY_CONFLICT | ERROR | Explicit currency sources conflict |
| IMPORT_INVALID_MONEY | ERROR | Money amount is missing, ambiguous or invalid |
| IMPORT_INVALID_QUANTITY | ERROR | Quantity is missing, ambiguous or invalid |
| IMPORT_DUPLICATE_IDENTIFIER | ERROR | Identifier repeats within one source table |
| IMPORT_INVALID_IDENTIFIER | WARNING | Identifier does not match legacy token syntax |
| IMPORT_POSSIBLE_DUPLICATE | WARNING | Review duplicate signal; never auto-merge |
| IMPORT_UNKNOWN_STATUS | WARNING | Commercial status is unassigned or unmapped |
| IMPORT_PRICE_CONFLICT | ERROR | Same price conditions and quantity have conflicting amounts |
| IMPORT_UNMAPPED_CATEGORY | WARNING | Category needs domain taxonomy review |
| IMPORT_UNMAPPED_OPTION | WARNING | Option requires semantic mapping review |
| IMPORT_DOMAIN_MAPPING_QUESTION | WARNING | Business meaning requires a domain decision |
| IMPORT_UNRESOLVED_REFERENCE | ERROR | Reference has zero or multiple source targets |
| IMPORT_HEADER_MISMATCH | ERROR | Expected table header is missing |
| IMPORT_FORMULA_VALUE_UNRESOLVED | WARNING | Formula is not evaluated by this parser |
| VARIANT_MATERIALIZATION_CANDIDATE | INFO | Independent operational identity may be justified |

CURRENCY_UNKNOWN in the brief maps to IMPORT_UNKNOWN_CURRENCY. DOMAIN_MAPPING_QUESTION maps to IMPORT_DOMAIN_MAPPING_QUESTION. VARIANT_MATERIALIZATION_CANDIDATE is a review signal, never a variant creation instruction.

Every issue has message, source and record_id (null only before header resolution). issue_id hashes record/code/detail when a record is available. Candidate issue_ids include dependency issues. ERROR marks technical rejection; WARNING requires review; INFO carries a non-authorizing observation. No severity bypasses human approval.
