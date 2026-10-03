"""Run: python -m parser.pipeline --sources DIR --output DIR"""
import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from . import VERSION
from .reader import inspect, stable_id, digest
from .adapters import records
from .mapper import map_candidates
from .validation import validate_identifiers, duplicates, issue

PRIMARY = 'Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx'
PRIOR = 'Design_To_Go_Catalog_v1.1_POST_OWNER_INTERVIEW_PATCHED.xlsx'


def dump(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')


def parse(path):
    profile, rows = inspect(path)
    batch_id = stable_id(VERSION, profile['sha256'], profile['source_file'])
    raw, issues = records(profile, rows, batch_id)
    issues += validate_identifiers(raw)
    candidate, history, mapping_issues = map_candidates(raw) if Path(path).name == PRIMARY else ([], [], [])
    issues += mapping_issues
    dup = duplicates(raw)
    index = {r['record_id']: r for r in raw}
    for d in dup:
        if d['kind'] != 'RELATIONSHIP_NOT_DUPLICATE':
            for rid in d['record_ids']:
                issues.append(issue(index[rid], 'IMPORT_POSSIBLE_DUPLICATE', ','.join(d['legacy_ids'])))
    for r in raw:
        if r['record_type'] != 'REFERENCE_ROW':
            for c in r['source']:
                if c['formula']:
                    if c['raw_value'] not in r['raw_payload'].values():
                        continue  # controls and demos retained in provenance/profile only
                    if r['record_type'] == 'PRECIOS' and c['source_column'] <= 3:
                        continue  # explicitly derived display columns; never candidate inputs
                    # Formula observations never pass silently as business values.
                    issues.append(issue(r, 'IMPORT_FORMULA_VALUE_UNRESOLVED', c['source_cell']))
    by_record = defaultdict(list)
    for v in issues:
        by_record[v['record_id']].append(v)
    for r in raw:
        r['issues'] = [v.get('issue_id', v['code']) for v in by_record[r['record_id']]]
    for c in candidate:
        relevant = [v for rid in c['record_ids'] for v in by_record[rid]]
        c['issue_ids'] = sorted({v.get('issue_id', v['code']) for v in relevant})
        c['validation_state'] = 'REJECTED' if any(v['severity'] == 'ERROR' for v in relevant) else 'WARNING' if relevant else 'VALID'
    return {'batch': {'batch_id': batch_id, 'parser_version': VERSION, 'source_file': Path(path).name,
                      'source_sha256': profile['sha256'], 'sheets_inspected': len(profile['sheets']),
                      'rows_inspected': sum(s['max_row'] for s in profile['sheets']),
                      'raw_records': len(raw), 'candidates_produced': len(candidate),
                      'issue_counts': dict(Counter(v['severity'] for v in issues)),
                      'source_role': 'PRIMARY_RC' if Path(path).name == PRIMARY else 'COMPARISON' if Path(path).name == PRIOR else 'SPECIALIZED_EVIDENCE'},
            'profile': profile, 'records': raw, 'candidates': candidate,
            'historical_prices': history, 'duplicate_reviews': dup, 'issues': issues}


def drift(before, after):
    def index(result):
        grouped = defaultdict(list)
        for r in result['records']:
            if r['legacy_id']:
                grouped[(r['record_type'], str(r['legacy_id']))].append(r)
        return grouped
    a, b = index(before), index(after)
    changes = []
    for k in sorted(a.keys() | b.keys()):
        old, new = a.get(k, []), b.get(k, [])
        if len(old) > 1 or len(new) > 1:
            changes.append({'table': k[0], 'legacy_id': k[1], 'kind': 'AMBIGUOUS_IDENTIFIER',
                            'before_ids': [r['record_id'] for r in old], 'after_ids': [r['record_id'] for r in new]})
        elif not old or not new:
            changes.append({'table': k[0], 'legacy_id': k[1], 'kind': 'ADDED' if new else 'REMOVED',
                            'before_ids': [r['record_id'] for r in old], 'after_ids': [r['record_id'] for r in new]})
        else:
            x, y = old[0]['normalized_payload'], new[0]['normalized_payload']
            fields = {f: {'before': x.get(f), 'after': y.get(f)} for f in sorted(x.keys() | y.keys()) if x.get(f) != y.get(f)}
            if fields:
                changes.append({'table': k[0], 'legacy_id': k[1], 'kind': 'CHANGED', 'fields': fields,
                                'before_id': old[0]['record_id'], 'after_id': new[0]['record_id']})
    return changes


def matrices(candidates):
    groups = defaultdict(list)
    for c in candidates:
        if c['kind'] != 'price':
            continue
        d = c['data']
        conds = sorted((str(x.get('Atributo_controlado')), str(x.get('Operador')), str(x.get('Valor')), str(x.get('Unidad'))) for x in d['conditions'])
        signature = json.dumps([d['item_legacy'], d['classification'], d['money']['currency'], d['amount_basis_evidence'], conds], ensure_ascii=False)
        groups[signature].append(c)
    return [{'signature': json.loads(k), 'candidate_ids': [c['candidate_id'] for c in cs],
             'points': [{'quantity': c['data']['quantity_from'], 'amount': c['data']['money']['amount'],
                         'candidate_id': c['candidate_id']} for c in cs],
             'interpolation_allowed': False, 'publishable': False} for k, cs in sorted(groups.items())]


def run(source_dir, output_dir):
    source_dir, out = Path(source_dir), Path(output_dir)
    if out.resolve() == source_dir.resolve() or source_dir.resolve() in out.resolve().parents:
        raise ValueError('Output must not be inside immutable source directory')
    paths = sorted(source_dir.glob('*.xlsx'))
    if not paths or not (source_dir / PRIMARY).exists():
        raise ValueError('Expected primary workbook and source workbooks')
    started = datetime.now(timezone.utc).isoformat()
    initial = {p.name: digest(p) for p in paths}
    results = {}
    for p in paths:
        results[p.name] = parse(p)
        dump(out / 'evidence' / (p.stem + '.json'), results[p.name])
    primary = results[PRIMARY]
    dump(out / 'evidence' / 'drift.json', drift(results[PRIOR], primary) if PRIOR in results else [])
    dump(out / 'evidence' / 'price-groups.json', matrices(primary['candidates']))
    wanted = {'Traditional Business Card': 'MIG1-O-008', 'Premium Business Card': 'MIG1-O-009',
              'Flyers': 'MIG2-O-036', 'Magnets': 'MIGF-O-015', 'Cotton T-Shirt': 'MIG1-O-004',
              'Dry Fit': 'MIG1-O-005', 'X-Banner': 'MIG1-O-003', 'Yard Sign': 'MIG1-O-020',
              'DTF Transfer': 'MIG1-O-015', 'DTF Gang Sheet': 'MIG1-O-016'}
    for name, legacy in wanted.items():
        associated = [r for r in primary['records'] if r['legacy_id'] == legacy or r['normalized_payload'].get('Oferta_ID') == legacy]
        price_ids = {r['legacy_id'] for r in associated if r['record_type'] == 'PRECIOS'}
        associated += [r for r in primary['records'] if r['record_type'] == 'CONDICIONES_PRECIO' and r['normalized_payload'].get('Precio_ID') in price_ids]
        # Real, self-contained subset: all referenced option values/method labels/composition endpoints included.
        related_candidates = [c for c in primary['candidates'] if c['data'].get('legacy_id') == legacy or c['data'].get('item_legacy') == legacy or c['data'].get('parent_legacy') == legacy]
        record_ids = {r['record_id'] for r in associated} | {rid for c in related_candidates for rid in c['record_ids']}
        associated = [r for r in primary['records'] if r['record_id'] in record_ids]
        dump(out / 'fixtures' / (name.lower().replace(' ', '-') + '.json'),
             {'name': name, 'legacy_id': legacy, 'synthetic': False, 'batch_id': primary['batch']['batch_id'],
              'records': associated, 'candidates': related_candidates,
              'historical_prices': [h for h in primary['historical_prices'] if h['data']['item_legacy'] == legacy]})
    final = {p.name: digest(p) for p in paths}
    if initial != final:
        raise RuntimeError('Source integrity failure')
    summary = {'parser_version': VERSION, 'batches': [r['batch'] for r in results.values()],
               'source_hashes_before': initial, 'source_hashes_after': final, 'sources_unchanged': initial == final,
               'primary_counts_by_table': dict(Counter(r['record_type'] for r in primary['records'] if not r['synthetic'])),
               'primary_test_counts': dict(Counter(r['record_type'] for r in primary['records'] if r['synthetic'])),
               'candidate_kinds': dict(Counter(c['kind'] for c in primary['candidates'])),
               'price_classifications': dict(Counter(c['data']['classification'] for c in primary['candidates'] if c['kind'] == 'price')),
               'historical_prices': len(primary['historical_prices']), 'price_groups': len(matrices(primary['candidates'])),
               'issues': dict(Counter(i['code'] for i in primary['issues']))}
    dump(out / 'evidence' / 'summary.json', summary)
    # Wall-clock execution metadata is intentionally outside deterministic content.
    dump(out / 'evidence' / 'run-metadata.json', {'started_at': started, 'ended_at': datetime.now(timezone.utc).isoformat(),
                                               'batch_ids': [r['batch']['batch_id'] for r in results.values()]})
    return summary


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--sources', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    print(json.dumps(run(args.sources, args.output), ensure_ascii=False, indent=2))
