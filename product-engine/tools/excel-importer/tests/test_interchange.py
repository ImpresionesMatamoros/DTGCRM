"""STEP 05B interchange tests. Synthetic tests run anywhere; real ones need DTG_SOURCES."""
import copy
import json
import os
from pathlib import Path
import unittest

from interchange import CONTRACT, CONTRACT_VERSION
from interchange.envelope import EnvelopeError, build
from interchange.presentation import presentation_candidates

SOURCES = Path(os.environ.get('DTG_SOURCES', '/nonexistent'))
PRIMARY = 'Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx'


def cell(sheet, row, col, value):
    return {'source_file': 'x.xlsx', 'workbook_sha256': 'f' * 64, 'source_sheet': sheet,
            'source_row': row, 'source_column': col, 'source_cell': f'A{row}', 'raw_value': value,
            'normalized_value': value, 'data_type': 's', 'formula': None, 'cached_value': None,
            'number_format': 'General'}


def record(rid, table, legacy, payload, synthetic=False):
    return {'record_id': rid, 'batch_id': 'b', 'record_type': table, 'legacy_id': legacy,
            'synthetic': synthetic, 'raw_payload': payload, 'normalized_payload': payload,
            'source': [cell(table, 2, i + 1, v) for i, v in enumerate(payload.values())], 'issues': []}


def synthetic_result():
    offer = record('r-offer', 'OFERTAS', 'X-O-1', {'Oferta_ID': 'X-O-1', 'Nombre': 'Item'})
    pres = record('r-pres', 'PRESENTACIONES', 'X-PR-1',
                  {'Presentación_ID': 'X-PR-1', 'Nombre_comercial': 'Para boda', 'Idioma': None,
                   'Audiencia_o_uso': 'Boda'})
    link = record('r-link', 'PRESENTACIÓN_OFERTA', 'X-PO-1',
                  {'Presentación_Oferta_ID': 'X-PO-1', 'Presentación_ID': 'X-PR-1', 'Oferta_ID': 'X-O-1'})
    test_link = record('r-test', 'PRESENTACIÓN_OFERTA', 'TEST-PO-1',
                       {'Presentación_Oferta_ID': 'TEST-PO-1', 'Presentación_ID': 'X-PR-1',
                        'Oferta_ID': 'X-O-1'}, synthetic=True)
    records = [offer, pres, link, test_link]
    item = {'candidate_id': 'c1', 'kind': 'catalog_item', 'record_ids': ['r-offer'],
            'data': {'legacy_id': 'X-O-1'}, 'source': offer['source'], 'workflow_state': 'PENDING_REVIEW',
            'publishable': False, 'validation_state': 'VALID', 'issue_ids': [], 'review': []}
    return {'batch': {'batch_id': 'b', 'parser_version': '0.1.0', 'source_file': 'x.xlsx',
                      'source_sha256': 'f' * 64, 'source_role': 'PRIMARY_RC', 'sheets_inspected': 3,
                      'rows_inspected': 10, 'raw_records': 4, 'candidates_produced': 1, 'issue_counts': {}},
            'profile': {'source_file': 'x.xlsx', 'sha256': 'f' * 64, 'reader_warnings': [],
                        'workbook_properties': {'title': None, 'version': None}, 'sheets': []},
            'records': records, 'candidates': [item], 'historical_prices': [], 'duplicate_reviews': [],
            'issues': []}


class SyntheticEnvelopeTests(unittest.TestCase):
    def test_contract_header(self):
        env = build(synthetic_result())
        self.assertEqual(env['contract'], CONTRACT)
        self.assertEqual(env['contract_version'], CONTRACT_VERSION)
        self.assertEqual(env['import_batch']['data_class'], 'REAL')
        self.assertNotIn('uuid', json.dumps(env).lower())

    def test_presentation_candidate_is_literal_and_excludes_test_rows(self):
        cands, issues = presentation_candidates(synthetic_result()['records'])
        self.assertEqual(len(cands), 1)
        self.assertEqual(cands[0]['record_ids'], ['r-link', 'r-pres', 'r-offer'])
        self.assertIsNone(cands[0]['data']['language'])
        self.assertFalse(cands[0]['publishable'])
        self.assertEqual([i['code'] for i in issues], ['IMPORT_DOMAIN_MAPPING_QUESTION'])

    def test_presentation_unresolved_reference(self):
        result = synthetic_result()
        result['records'] = [r for r in result['records'] if r['record_id'] != 'r-pres']
        _, issues = presentation_candidates(result['records'])
        self.assertIn('IMPORT_UNRESOLVED_REFERENCE', [i['code'] for i in issues])

    def test_candidates_reference_records_without_copying_cells(self):
        env = build(synthetic_result())
        self.assertNotIn('source', env['candidates'][0])
        self.assertEqual([c['kind'] for c in env['candidates']], ['catalog_item', 'presentation'])
        self.assertEqual(env['candidates'][1]['validation_state'], 'WARNING')

    def test_lost_provenance_fails_closed(self):
        result = synthetic_result()
        result['candidates'][0]['source'] = []
        with self.assertRaises(EnvelopeError):
            build(result)

    def test_invalid_data_class(self):
        with self.assertRaises(EnvelopeError):
            build(synthetic_result(), data_class='PROD')

    def test_deterministic(self):
        a, b = build(synthetic_result()), build(copy.deepcopy(synthetic_result()))
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))


@unittest.skipUnless((SOURCES / PRIMARY).exists(), 'DTG_SOURCES with the real workbooks is required')
class RealEnvelopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from parser.pipeline import parse
        from parser.reader import digest
        cls.digest = staticmethod(digest)
        cls.before = {p.name: digest(p) for p in SOURCES.glob('*.xlsx')}
        cls.result = parse(SOURCES / PRIMARY)
        cls.env = build(cls.result)

    def test_counts(self):
        b = self.env['import_batch']
        self.assertEqual(b['record_count'], 1648)
        self.assertEqual(b['candidate_counts'], {'catalog_item': 220, 'composition': 5, 'decoration': 92,
                                                 'option': 70, 'presentation': 12, 'price': 131})
        self.assertEqual(b['historical_price_count'], 23)

    def test_historical_prices_never_candidates(self):
        historical = {h['record_id'] for h in self.env['historical_prices']}
        used = {rid for c in self.env['candidates'] for rid in c['record_ids']}
        price_rows = {c['record_ids'][0] for c in self.env['candidates'] if c['kind'] == 'price'}
        self.assertFalse(historical & price_rows)
        self.assertEqual(len(historical), 23)
        self.assertTrue(all(c['publishable'] is False for c in self.env['candidates']))
        self.assertTrue(used <= {r['record_id'] for r in self.env['records']})

    def test_presentations_real_only(self):
        pres = [c for c in self.env['candidates'] if c['kind'] == 'presentation']
        synthetic = {r['record_id'] for r in self.env['records'] if r['synthetic']}
        self.assertEqual(len(pres), 12)
        self.assertFalse(synthetic & {rid for c in pres for rid in c['record_ids']})

    def test_required_null_preserved(self):
        opts = [c for c in self.env['candidates'] if c['kind'] == 'option']
        self.assertTrue(all(c['data']['required'] is None for c in opts))

    def test_sources_unchanged(self):
        self.assertEqual(self.before, {p.name: self.digest(p) for p in SOURCES.glob('*.xlsx')})


if __name__ == '__main__':
    unittest.main()
