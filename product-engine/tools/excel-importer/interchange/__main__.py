"""Export ImportEnvelope v1 files.

    python -m interchange --sources DIR --output DIR            # REAL: one envelope per workbook
    python -m interchange --sources DIR --output DIR --fixtures # FIXTURE: the ten STEP 05A fixtures

Source workbooks are opened read-only and their SHA-256 is checked before and
after the run. Output is deterministic (sorted keys, no timestamps).
"""
import argparse
import json
from pathlib import Path

from parser.pipeline import PRIMARY, parse
from parser.reader import digest

from .envelope import build

# Same selection as STEP 05A parser.pipeline.run (fixtures section).
FIXTURES = {'Traditional Business Card': 'MIG1-O-008', 'Premium Business Card': 'MIG1-O-009',
            'Flyers': 'MIG2-O-036', 'Magnets': 'MIGF-O-015', 'Cotton T-Shirt': 'MIG1-O-004',
            'Dry Fit': 'MIG1-O-005', 'X-Banner': 'MIG1-O-003', 'Yard Sign': 'MIG1-O-020',
            'DTF Transfer': 'MIG1-O-015', 'DTF Gang Sheet': 'MIG1-O-016'}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    path.write_text(text + '\n', encoding='utf-8')


def fixture_envelope(result, name, legacy):
    records = result['records']
    candidates = result['candidates']

    def related(c):
        d = c['data']
        return legacy in (d.get('legacy_id'), d.get('item_legacy'), d.get('parent_legacy'))

    associated = [r for r in records
                  if r['legacy_id'] == legacy or r['normalized_payload'].get('Oferta_ID') == legacy]
    price_ids = {r['legacy_id'] for r in associated if r['record_type'] == 'PRECIOS'}
    associated += [r for r in records if r['record_type'] == 'CONDICIONES_PRECIO'
                   and r['normalized_payload'].get('Precio_ID') in price_ids]
    wanted = {r['record_id'] for r in associated}
    wanted |= {rid for c in candidates if related(c) for rid in c['record_ids']}
    # Composition children of the fixture item are part of the controlled subset.
    children = {c['data'].get('child_legacy') for c in candidates
                if c['kind'] == 'composition' and c['data'].get('parent_legacy') == legacy}
    wanted |= {rid for c in candidates if c['kind'] == 'catalog_item'
               and c['data'].get('legacy_id') in children for rid in c['record_ids']}

    def keep_candidate(c):
        return related(c) or (c['kind'] == 'catalog_item' and c['data'].get('legacy_id') in children)

    return build(result, data_class='FIXTURE', fixture_name=name, include_profile=False,
                 record_filter=lambda rid: rid in wanted, candidate_filter=keep_candidate)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--sources', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    cli.add_argument('--fixtures', action='store_true')
    cli.add_argument('--only', help='comma-separated fixture file stems (with --fixtures)')
    args = cli.parse_args()
    sources, out = args.sources.resolve(), args.output.resolve()
    if out == sources or sources in out.parents:
        raise SystemExit('Output must not be inside the immutable source directory')
    paths = sorted(sources.glob('*.xlsx'))
    if not (sources / PRIMARY).exists():
        raise SystemExit('Primary workbook not found: ' + PRIMARY)
    before = {p.name: digest(p) for p in paths}
    written = []
    if args.fixtures:
        result = parse(sources / PRIMARY)
        only = set(args.only.split(',')) if args.only else None
        for name, legacy in FIXTURES.items():
            stem = name.lower().replace(' ', '-')
            if only is not None and stem not in only:
                continue
            target = out / (stem + '.envelope.json')
            write(target, fixture_envelope(result, name, legacy))
            written.append(target.name)
    else:
        for p in paths:
            target = out / (p.stem + '.envelope.json')
            write(target, build(parse(p)))
            written.append(target.name)
    after = {p.name: digest(p) for p in paths}
    if before != after:
        raise SystemExit('Source integrity failure: a workbook changed during export')
    print(json.dumps({'written': written, 'source_sha256': before, 'sources_unchanged': True},
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
