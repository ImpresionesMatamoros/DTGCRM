"""STEP 05B interchange: STEP 05A parser result -> ImportEnvelope (neutral, versioned JSON).

The parser (``parser/``, version 0.1.0) is used unchanged. This package only
serializes its result into the contract consumed by the TypeScript import
bridge (``src/import/contract.ts``) and adds presentation evidence candidates.
It never assigns Product Engine identities, public codes or publication state.
"""

CONTRACT = 'dtg.import-envelope'
CONTRACT_VERSION = '1.0.0'
EXPORTER_VERSION = '1.0.0'
PARSER_NAME = 'dtg-step05a-parser'
