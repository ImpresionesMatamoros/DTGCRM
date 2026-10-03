"""Regenerate compact discovery reports from parser evidence; no source mutations."""
import json
import re
from collections import Counter
from pathlib import Path
from .pipeline import PRIMARY, PRIOR, dump
from .reader import digest


def report(output):
    root = Path(output)
    load = lambda n: json.loads((root / 'evidence' / n).read_text(encoding='utf8'))
    summary = load('summary.json')
    primary = load(Path(PRIMARY).stem + '.json')
    lines = ['# Excel source profile', '', 'Generated from immutable workbook bytes with openpyxl 3.1.5. '
             'Formula text and cached results are retained separately; this parser does not recalculate Excel.', '',
             '## Workbook and sheet inventory', '',
             'Literal rows include headings and documentation. Raw table records exclude formula-only scaffolding. '
             'Full formulas, merged ranges, validations, hidden dimensions, data types and header candidates are in each evidence JSON.', '']
    observations = []
    for b in summary['batches']:
        d = load(Path(b['source_file']).stem + '.json')
        lines += ['### ' + b['source_file'], '', 'SHA-256: `' + b['source_sha256'] + '`', '',
                  '| Sheet | Dimensions | Literal rows | Formulas | Visibility | Validations |', '|---|---|---:|---:|---|---:|']
        for s in d['profile']['sheets']:
            lines.append(f"| {s['name']} | {s['dimensions']} | {s['literal_rows']} | {s['formula_count']} | {s['state']} | {len(s['validations'])} |")
            for f in s['formulas']:
                if isinstance(f['cached_value'], str) and f['cached_value'].startswith(('#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NUM!', '#NULL!')):
                    observations.append({'code': 'CACHED_FORMULA_ERROR', 'file': b['source_file'], 'sheet': s['name'], **f})
        lines += ['', f"Raw records: {b['raw_records']}; candidates: {b['candidates_produced']}. Role: {b['source_role']}.", '']
        if d['profile']['reader_warnings']:
            lines += ['Reader notices: ' + '; '.join(d['profile']['reader_warnings']),
                      'These concern unsupported formatting extensions on save. No workbook is saved by this pipeline.', '']
    lines += ['## Primary source reconciliation', '', '| Table | Real | TEST excluded |', '|---|---:|---:|']
    for table in sorted(summary['primary_counts_by_table'].keys() | summary['primary_test_counts'].keys()):
        lines.append(f"| {table} | {summary['primary_counts_by_table'].get(table, 0)} | {summary['primary_test_counts'].get(table, 0)} |")
    lines += ['', '131 price candidates = 130 exact-quantity points + 1 fixed-price observation. '
              'Grouping gives 13 exact matrices + 1 fixed-price group. The fixed magnet price is not an extra quantity break. '
              'STEP 03 describes 14 definitions / 131 breaks; retain this representational difference for STEP 05B.', '',
              '## Field distributions', '']
    for table, fields in {'OFERTAS': ['SKU', 'Clase', 'Estado_comercial', 'Categoría_ID', 'Unidad_predeterminada'],
                           'PRECIOS': ['Modelo', 'Moneda', 'Base_de_cobro', 'Estado_de_precio', 'Revisado']}.items():
        rs = [r for r in primary['records'] if r['record_type'] == table and not r['synthetic']]
        for field in fields:
            counts = Counter(str(r['normalized_payload'].get(field)) for r in rs)
            lines += [f'- {table}.{field}: ' + ', '.join(f'`{k}`={v}' for k, v in sorted(counts.items()))]
    lines += ['', '## Identifiers, joins and version drift', '',
              'Legacy keys are scoped by workbook hash + table. LISTAS uses Valor_ID as row key, not repeated Lista_ID. '
              'No legacy key or SKU becomes a permanent identity or public code.', '']
    delta = load('drift.json')
    counts = Counter((c['table'], c['kind']) for c in delta)
    lines += ['| Table | Change | Count |', '|---|---|---:|']
    for (table, kind), count in sorted(counts.items()):
        lines.append(f'| {table} | {kind} | {count} |')
    lines += ['', 'Cell-level raw/normalized provenance for the before/after IDs is in the two workbook evidence files. '
              'Drift is evidence; records from the prior workbook never enter primary staging.', '',
              '## Anomalies and specialized evidence', '',
              '- v1.2 LISTAS!K3 claims 103 authorized prices / 12 master card prices; actual rows show 131 / 40. Banner is stale.',
              '- 197/220 commercial statuses are blank. Authorization of a price does not prove an ACTIVE item.',
              '- All 220 real SKU cells are blank. Legacy migration IDs are unique within their source tables.',
              '- Comprehension RESUMEN!A5 reports 219 identities; it is a separate evidence snapshot, not authority to drop one of the 220 primary offers.',
              '- Comprehension HITOS row 4 mentions 26 waterproof price points; the supplied primary price table does not contain those 26 rows. Do not reconstruct them.',
              '- Gorras benchmarks and proposal prices are external/proposed evidence, not DTG supplier costs or authorized prices.',
              '- Source PDF (2026-09-25, page 1) gives contextual caps $5–11 USD, personalized Yeti-style cups $16, shirts $12 by quantity. Configuration/quantity scope is incomplete; it does not authorize replacing primary prices.',
              '- No explicit real MXN price rows were found in primary PRECIOS. No Mexico prices are calculated or overwritten.',
              '- Whole notes, embedded original records and absorbed-ID narratives remain literal evidence; owner decisions and aliases are not automatically asserted from prose.',
              '', 'Cached formula anomalies: ' + str(len(observations)) + '. See `evidence/anomalies.json`.', '']
    dump(root / 'evidence/anomalies.json', observations)
    (root / 'EXCEL-SOURCE-PROFILE.md').write_text('\n'.join(lines), encoding='utf8')
    return summary


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--output', type=Path, default=Path('.'))
    report(p.parse_args().output)
