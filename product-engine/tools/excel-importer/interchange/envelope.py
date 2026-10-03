"""Serialize a STEP 05A parse result as an ImportEnvelope v1.

Rules:
- Records keep raw_payload, normalized_payload and every SourceCell verbatim.
- Candidates reference records by record_id; their cell list is NOT repeated.
  The exporter proves that the parser's candidate `source` equals the
  concatenation of its records' cells, so nothing is lost.
- Historical prices stay in their own section, never among candidates.
- Issues keep the parser's code/severity/message; the cell list is only
  embedded when the issue has no record (header-level errors).
"""
from collections import Counter, defaultdict

from . import CONTRACT, CONTRACT_VERSION, EXPORTER_VERSION, PARSER_NAME
from .presentation import presentation_candidates

CELL_FIELDS = ('source_file', 'workbook_sha256', 'source_sheet', 'source_row', 'source_column',
               'source_cell', 'raw_value', 'normalized_value', 'data_type', 'formula',
               'cached_value', 'number_format')
KIND_ORDER = ('catalog_item', 'option', 'decoration', 'composition', 'price', 'presentation')


class EnvelopeError(ValueError):
    pass


def _cells(cells):
    return [{k: c[k] for k in CELL_FIELDS} for c in cells]


def _cells_of(index, record_ids):
    return [c for rid in record_ids for c in index[rid]['source']]


def _validation_state(issues):
    if any(i['severity'] == 'ERROR' for i in issues):
        return 'REJECTED'
    return 'WARNING' if issues else 'VALID'


def _condition_record_ids(records, data):
    wanted = {c.get('Condición_ID') for c in data['conditions']}
    return [r['record_id'] for r in records
            if r['record_type'] == 'CONDICIONES_PRECIO' and r['legacy_id'] in wanted]


def build(result, data_class='REAL', fixture_name=None, include_profile=True,
          record_filter=None, candidate_filter=None):
    """Return the envelope dict for one workbook parse result."""
    if data_class not in ('REAL', 'FIXTURE'):
        raise EnvelopeError('data_class must be REAL or FIXTURE')
    records = result['records']
    index = {r['record_id']: r for r in records}
    if len(index) != len(records):
        raise EnvelopeError('duplicate record_id in parser result')

    is_primary = result['batch']['source_role'] == 'PRIMARY_RC'
    pres, pres_issues = presentation_candidates(records) if is_primary else ([], [])
    all_issues = [dict(i, origin='PARSER') for i in result['issues']] + \
                 [dict(i, origin='INTERCHANGE') for i in pres_issues]
    by_record = defaultdict(list)
    for i in all_issues:
        by_record[i['record_id']].append(i)
    for c in pres:
        relevant = [i for rid in c['record_ids'] for i in by_record[rid]]
        c['issue_ids'] = sorted({i['issue_id'] for i in relevant})
        c['validation_state'] = _validation_state(relevant)

    candidates = result['candidates'] + pres
    for c in candidates:
        if c['source'] != _cells_of(index, c['record_ids']):
            raise EnvelopeError(f"candidate {c['candidate_id']} cells differ from its records")
    for i in all_issues:
        if i['record_id'] is not None and i['source'] != index[i['record_id']]['source']:
            raise EnvelopeError(f"issue {i.get('issue_id')} cells differ from its record")

    historical = []
    for h in result['historical_prices']:
        cond_ids = _condition_record_ids(records, h['data'])
        if h['source'] != _cells_of(index, [h['record_id']] + cond_ids):
            raise EnvelopeError(f"historical {h['record_id']} cells differ from its records")
        historical.append({'record_id': h['record_id'], 'condition_record_ids': cond_ids,
                           'data': h['data']})

    reviews = []
    for d in result['duplicate_reviews']:
        if d['source'] != _cells_of(index, d['record_ids']):
            raise EnvelopeError('duplicate review cells differ from its records')
        reviews.append({k: d[k] for k in ('kind', 'record_ids', 'legacy_ids', 'signals', 'recommendation')})

    keep = (lambda rid: True) if record_filter is None else record_filter
    keep_candidate = (lambda c: True) if candidate_filter is None else candidate_filter
    out_records = [r for r in records if keep(r['record_id'])]
    kept = {r['record_id'] for r in out_records}
    out_candidates = [c for c in candidates if keep_candidate(c)]
    for c in out_candidates:
        missing = set(c['record_ids']) - kept
        if missing:
            raise EnvelopeError(f"candidate {c['candidate_id']} references records outside envelope")
    out_issues = [i for i in all_issues if i['record_id'] is None or i['record_id'] in kept]
    if record_filter is not None:
        out_issues = [i for i in out_issues if i['record_id'] is not None]
    out_historical = [h for h in historical
                      if h['record_id'] in kept and set(h['condition_record_ids']) <= kept]
    out_reviews = [d for d in reviews if set(d['record_ids']) <= kept]
    issue_keys = defaultdict(list)
    for i in out_issues:
        issue_keys[i['record_id']].append(i['issue_id'])

    batch = result['batch']
    profile = result['profile']
    envelope = {
        'contract': CONTRACT,
        'contract_version': CONTRACT_VERSION,
        'producer': {'exporter_version': EXPORTER_VERSION, 'parser_name': PARSER_NAME,
                     'parser_version': batch['parser_version']},
        'import_batch': {
            'source_batch_id': batch['batch_id'],
            'source_file': batch['source_file'],
            'source_sha256': batch['source_sha256'],
            'source_role': batch['source_role'],
            'data_class': data_class,
            'fixture_name': fixture_name,
            'sheets_inspected': batch['sheets_inspected'],
            'rows_inspected': batch['rows_inspected'],
            'parser_counts': {'raw_records': batch['raw_records'],
                              'candidates_produced': batch['candidates_produced'],
                              'issue_counts': batch['issue_counts']},
            'record_count': len(out_records),
            'candidate_count': len(out_candidates),
            'candidate_counts': dict(sorted(Counter(c['kind'] for c in out_candidates).items())),
            'issue_counts': dict(sorted(Counter(i['severity'] for i in out_issues).items())),
            'historical_price_count': len(out_historical),
        },
        'provenance': {
            'workbook': {'source_file': profile['source_file'], 'sha256': profile['sha256'],
                         'title': profile['workbook_properties'].get('title'),
                         'version': profile['workbook_properties'].get('version'),
                         'reader_warnings': profile['reader_warnings']},
            'profile': profile if include_profile else None,
        },
        'records': [{
            'record_id': r['record_id'], 'record_type': r['record_type'], 'legacy_id': r['legacy_id'],
            'synthetic': r['synthetic'], 'raw_payload': r['raw_payload'],
            'normalized_payload': r['normalized_payload'], 'source': _cells(r['source']),
            'issue_ids': sorted(i for i in issue_keys[r['record_id']] if i is not None),
        } for r in out_records],
        'candidates': [{
            'candidate_id': c['candidate_id'], 'kind': c['kind'], 'record_ids': c['record_ids'],
            'data': c['data'], 'workflow_state': c['workflow_state'], 'publishable': c['publishable'],
            'validation_state': c['validation_state'], 'issue_ids': c['issue_ids'], 'review': c['review'],
        } for c in sorted(out_candidates, key=lambda c: (KIND_ORDER.index(c['kind']), c['candidate_id']))],
        'historical_prices': out_historical,
        'duplicate_reviews': out_reviews,
        'issues': [{
            'issue_id': i.get('issue_id'), 'code': i['code'], 'severity': i['severity'],
            'message': i['message'], 'record_id': i['record_id'], 'origin': i['origin'],
            'source': _cells(i['source']) if i['record_id'] is None else None,
        } for i in out_issues],
    }
    return envelope
