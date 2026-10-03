"""Compact, cell-free extract of the real price evidence (for CI tests of price grouping).

    python -m interchange.price_evidence --sources DIR --output FILE
"""
import argparse
import json
from pathlib import Path

from parser.pipeline import PRIMARY, parse
from parser.reader import digest

from .envelope import build


def extract(envelope):
    prices = [c for c in envelope['candidates'] if c['kind'] == 'price']
    hist = envelope['historical_prices']
    need = {rid for c in prices for rid in c['record_ids']}
    need |= {h['record_id'] for h in hist} | {rid for h in hist for rid in h['condition_record_ids']}
    records = [{'record_id': r['record_id'], 'record_type': r['record_type'], 'legacy_id': r['legacy_id']}
               for r in envelope['records'] if r['record_id'] in need]
    return {'_about': 'Derived from ImportEnvelope v1 of ' + envelope['import_batch']['source_file']
                      + ' (parser ' + envelope['producer']['parser_version'] + '). Price candidates and '
                      'historical prices only; cells omitted. Regenerate: pnpm importer:envelopes --fixtures.',
            'source_sha256': envelope['import_batch']['source_sha256'],
            'price_candidates': prices, 'historical_prices': hist, 'records': records}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--sources', type=Path, required=True)
    cli.add_argument('--output', type=Path, required=True)
    args = cli.parse_args()
    path = args.sources / PRIMARY
    before = digest(path)
    data = extract(build(parse(path)))
    if digest(path) != before:
        raise SystemExit('Source integrity failure')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n',
                           encoding='utf-8')


if __name__ == '__main__':
    main()
