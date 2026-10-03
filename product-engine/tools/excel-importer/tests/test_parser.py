import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from parser.normalizers import text, money, quantity, boolean, measurement
from parser.pipeline import parse, PRIMARY, matrices, drift
from parser.reader import digest
from parser.mapper import map_candidates
from parser.validation import duplicates, duplicate_kind, validate_identifiers
from parser.adapters import records

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT.parent / 'work/DTG_Product_Engine_STEP_05A_ASTRA_LIGHT/02_SOURCE_WORKBOOKS'
SOURCES = Path(os.environ.get('DTG_SOURCES', DEFAULT))


class NormalizationTests(unittest.TestCase):
    def test_text(self):
        self.assertEqual(text(' \u200bPremium\xa0 '), 'Premium')
        self.assertIsNone(text(None))
        self.assertEqual(text(' '), '')

    def test_money(self):
        self.assertEqual(money('25 dlls')['currency'], 'USD')
        self.assertEqual(money('25 USD')['amount'], '25')
        self.assertEqual(money('$25', 'USD')['currency'], 'USD')
        self.assertEqual(money('$1,250.50', 'USD')['amount'], '1250.50')

    def test_unknown_currency(self):
        self.assertIsNone(money('$25')['currency'])
        self.assertIn('IMPORT_UNKNOWN_CURRENCY', money(25)['issues'])
        self.assertIsNone(money('25 USD', 'MXN')['currency'])
        self.assertIn('IMPORT_CURRENCY_CONFLICT', money('25 USD', 'MXN')['issues'])

    def test_ambiguous_money(self):
        for v in ('25,50', '$15–20 c/u', '=A1*2', True, None):
            self.assertIsNone(money(v)['amount'])

    def test_quantity(self):
        self.assertEqual(quantity(500), {'kind': 'EXACT', 'value': 500})
        self.assertEqual(quantity('6-12')['kind'], 'RANGE')
        self.assertEqual(quantity('12+')['kind'], 'MINIMUM')
        for v in ('1 / 6 / 12', 'muchas', 0, -1, True, 1.5, '12-6'):
            self.assertEqual(quantity(v)['kind'], 'AMBIGUOUS')

    def test_measurement(self):
        self.assertEqual(measurement('18 × 24 in')['unit'], 'in')
        self.assertIsNone(measurement('18x24')['unit'])
        for unit in ('ft', 'cm', 'm'):
            self.assertEqual(measurement('2x3 ' + unit)['unit'], unit)
            self.assertEqual(measurement('18 ' + unit)['kind'], 'LENGTH')

    def test_blank_boolean(self):
        for v in (None, '', 'unknown', 0, 1):
            self.assertIsNone(boolean(v))
        self.assertIs(boolean('No'), False)
        self.assertIs(boolean('Sí'), True)

    def test_duplicates(self):
        self.assertEqual(duplicate_kind('Same Name', ' same name ')[0], 'EXACT_DUPLICATE')
        self.assertEqual(duplicate_kind('Business Card Premium', 'Premium Business Cards')[0], 'PROBABLE_DUPLICATE')
        self.assertEqual(duplicate_kind('X-Banner Stand', 'X-Banner Complete')[0], 'RELATIONSHIP_NOT_DUPLICATE')
        self.assertIsNone(duplicate_kind('X-Banner Complete', 'Roll-Up Banner')[0])
        self.assertEqual(duplicate_kind('Llavero', 'Llavero UV DTF')[0], 'PROBABLE_DUPLICATE')


class RealSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (SOURCES / PRIMARY).exists():
            raise RuntimeError('Real source tests require DTG_SOURCES pointing to all five input workbooks')
        cls.before = {p.name: digest(p) for p in SOURCES.glob('*.xlsx')}
        cls.result = parse(SOURCES / PRIMARY)
        cls.real = [r for r in cls.result['records'] if not r['synthetic']]

    def test_workbook_loads_and_discovery(self):
        self.assertEqual(len(self.result['profile']['sheets']), 15)
        self.assertIn('CONDICIONES_PRECIO', [s['name'] for s in self.result['profile']['sheets']])

    def test_all_five_workbooks(self):
        self.assertEqual(len(self.before), 5)
        for name in self.before:
            saved = json.loads((ROOT / 'evidence' / (Path(name).stem + '.json')).read_text(encoding='utf8'))
            self.assertEqual(saved['profile']['sha256'], self.before[name])
            self.assertGreater(len(saved['records']), 0)

    def test_header_parsing(self):
        p = next(r for r in self.real if r['record_type'] == 'PRECIOS')
        self.assertIn('Precio_ID', p['normalized_payload'])
        self.assertTrue(any(c['source_column'] == 8 and c['raw_value'] == p['legacy_id'] for c in p['source']))

    def test_header_drift_fails_closed(self):
        profile = {'sha256': 'a', 'source_file': 'test'}
        rows = [{'source_sheet': 'OFERTAS', 'source_row': 5, 'cells': [{'raw_value': 'Renamed_ID', 'formula': None,
                 'normalized_value': 'Renamed_ID', 'source_column': 1, 'source_cell': 'A5'}]}]
        raw, issues = records(profile, rows, 'batch')
        self.assertEqual(issues[0]['code'], 'IMPORT_HEADER_MISMATCH')
        self.assertEqual(raw[0]['record_type'], 'REFERENCE_ROW')

    def test_counts(self):
        self.assertEqual(len([r for r in self.real if r['record_type'] == 'OFERTAS']), 220)
        self.assertEqual(len([r for r in self.real if r['record_type'] == 'PRECIOS']), 154)
        self.assertEqual(len(self.result['historical_prices']), 23)

    def test_provenance(self):
        for c in self.result['candidates']:
            self.assertTrue(c['source'])
            for s in c['source']:
                for field in ('source_file', 'workbook_sha256', 'source_sheet', 'source_row', 'source_cell', 'raw_value', 'normalized_value'):
                    self.assertIn(field, s)
        offer = next(r for r in self.real if r['legacy_id'] == 'MIG1-O-004')
        self.assertTrue(any(c['source_column'] == 17 and c['raw_value'] == 'SIN EVALUAR' for c in offer['source']))

    def test_matrix_extraction(self):
        ps = [c for c in self.result['candidates'] if c['kind'] == 'price']
        self.assertEqual(len(ps), 131)
        self.assertEqual(sum(c['data']['classification'] == 'EXACT_QUANTITY_MATRIX' for c in ps), 130)
        self.assertEqual(len(matrices(ps)), 14)
        matches = [c for c in ps if c['data']['item_legacy'] == 'MIG1-O-009' and c['data']['quantity_from'].get('value') == 500
                   and any(str(v.get('Valor')) == '2' for v in c['data']['conditions'])]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]['data']['money']['amount'], '120')
        self.assertFalse(any(c['data']['quantity_from'].get('value') == 750 for c in ps))

    def test_historical_isolation(self):
        price_ids = {c['record_ids'][0] for c in self.result['candidates'] if c['kind'] == 'price'}
        self.assertFalse(price_ids & {h['record_id'] for h in self.result['historical_prices']})
        self.assertTrue(all(not c['publishable'] for c in self.result['candidates']))

    def test_no_test_candidates(self):
        synthetic = {r['record_id'] for r in self.result['records'] if r['synthetic']}
        self.assertFalse(synthetic & {rid for c in self.result['candidates'] for rid in c['record_ids']})

    def test_unknown_status(self):
        items = [c for c in self.result['candidates'] if c['kind'] == 'catalog_item']
        self.assertEqual(sum(c['data']['catalog_status_hypothesis'] is None for c in items), 197)

    def test_method_product_separation(self):
        for legacy in ('MIG1-O-015', 'MIG1-O-016'):
            item = next(c for c in self.result['candidates'] if c['kind'] == 'catalog_item' and c['data']['legacy_id'] == legacy)
            self.assertEqual(item['data']['item_type_hypothesis'], 'PRODUCT')
        self.assertTrue(any(c['kind'] == 'decoration' for c in self.result['candidates']))
        self.assertFalse(any(c['kind'] == 'option' and c['data']['name'] == 'modalidad' for c in self.result['candidates']))

    def test_mutated_currency(self):
        raw = copy.deepcopy(self.result['records'])
        r = next(r for r in raw if r['record_type'] == 'PRECIOS' and not r['synthetic'] and r['normalized_payload']['Estado_de_precio'] == 'Confirmado')
        r['normalized_payload']['Moneda'] = None
        cs, hs, issues = map_candidates(raw)
        c = next(c for c in cs if c['record_ids'][0] == r['record_id'])
        self.assertEqual(c['data']['classification'], 'UNKNOWN_REVIEW_REQUIRED')
        self.assertIn('IMPORT_UNKNOWN_CURRENCY', [i['code'] for i in issues])

    def test_duplicate_identifier(self):
        r = next(r for r in self.real if r['record_type'] == 'OFERTAS')
        self.assertEqual(len([i for i in validate_identifiers([r, r]) if i['code'] == 'IMPORT_DUPLICATE_IDENTIFIER']), 2)

    def test_single_value_attributes(self):
        excluded = {'MIGF-OP-001', 'OWN-OP-009', 'OWN-OP-010', 'OWN-OP-007'}
        ids = {r['record_id'] for r in self.real if r['legacy_id'] in excluded}
        self.assertFalse(ids & {c['record_ids'][0] for c in self.result['candidates'] if c['kind'] == 'option'})

    def test_pending_price_is_not_authorized(self):
        raw = copy.deepcopy(self.result['records'])
        r = next(r for r in raw if r['record_type'] == 'PRECIOS' and not r['synthetic'] and r['normalized_payload']['Estado_de_precio'] == 'Confirmado')
        r['normalized_payload']['Estado_de_precio'] = 'Pendiente'
        r['normalized_payload']['Notas'] = None
        cs, _, _ = map_candidates(raw)
        c = next(c for c in cs if c['record_ids'][0] == r['record_id'])
        self.assertEqual(c['data']['classification'], 'UNKNOWN_REVIEW_REQUIRED')

    def test_price_conflict(self):
        raw = copy.deepcopy(self.result['records'])
        p = copy.deepcopy(next(r for r in raw if r['record_type'] == 'PRECIOS' and not r['synthetic'] and r['normalized_payload']['Modelo'] == 'Fijo'))
        p['record_id'] += '-conflict'
        p['normalized_payload']['Importe'] = 99
        raw.append(p)
        _, _, issues = map_candidates(raw)
        self.assertIn('IMPORT_PRICE_CONFLICT', [i['code'] for i in issues])

    def test_source_unchanged(self):
        self.assertEqual(self.before, {p.name: digest(p) for p in SOURCES.glob('*.xlsx')})

    def test_determinism(self):
        self.assertEqual(self.result, parse(SOURCES / PRIMARY))

    def test_fixtures(self):
        fs = list((ROOT / 'fixtures').glob('*.json'))
        self.assertEqual(len(fs), 10)
        for path in fs:
            f = json.loads(path.read_text(encoding='utf8'))
            self.assertFalse(f['synthetic'])
            self.assertTrue(f['records'])


if __name__ == '__main__':
    unittest.main()
