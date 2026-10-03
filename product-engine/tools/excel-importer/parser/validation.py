"""Stable issue objects and review-only duplicate signals."""
import re
from collections import defaultdict
from itertools import combinations
from .normalizers import key
from .reader import stable_id

TAXONOMY = {
    'IMPORT_MISSING_REQUIRED_SOURCE_VALUE': ('ERROR', 'Required source value is absent'),
    'IMPORT_UNKNOWN_CURRENCY': ('WARNING', 'Currency is not supported by explicit evidence'),
    'IMPORT_CURRENCY_CONFLICT': ('ERROR', 'Explicit currency sources conflict'),
    'IMPORT_INVALID_MONEY': ('ERROR', 'Money amount is missing, ambiguous or invalid'),
    'IMPORT_INVALID_QUANTITY': ('ERROR', 'Quantity is missing, ambiguous or invalid'),
    'IMPORT_DUPLICATE_IDENTIFIER': ('ERROR', 'Identifier repeats within one source table'),
    'IMPORT_INVALID_IDENTIFIER': ('WARNING', 'Identifier does not match legacy token syntax'),
    'IMPORT_POSSIBLE_DUPLICATE': ('WARNING', 'Review duplicate signal; never auto-merge'),
    'IMPORT_UNKNOWN_STATUS': ('WARNING', 'Commercial status is unassigned or unmapped'),
    'IMPORT_PRICE_CONFLICT': ('ERROR', 'Same price conditions and quantity have conflicting amounts'),
    'IMPORT_UNMAPPED_CATEGORY': ('WARNING', 'Category needs domain taxonomy review'),
    'IMPORT_UNMAPPED_OPTION': ('WARNING', 'Option requires semantic mapping review'),
    'IMPORT_DOMAIN_MAPPING_QUESTION': ('WARNING', 'Business meaning requires a domain decision'),
    'IMPORT_UNRESOLVED_REFERENCE': ('ERROR', 'Reference has zero or multiple source targets'),
    'IMPORT_HEADER_MISMATCH': ('ERROR', 'Expected table header is missing'),
    'IMPORT_FORMULA_VALUE_UNRESOLVED': ('WARNING', 'Formula is not evaluated by this parser'),
    'VARIANT_MATERIALIZATION_CANDIDATE': ('INFO', 'Independent operational identity may be justified'),
}


def issue(record, code, detail='', severity=None):
    default, message = TAXONOMY[code]
    return {'issue_id': stable_id(record['record_id'], code, detail), 'code': code,
            'severity': severity or default, 'message': message + (': ' + detail if detail else ''),
            'record_id': record['record_id'], 'source': record['source']}


def validate_identifiers(records):
    grouped, issues = defaultdict(list), []
    for r in records:
        if r['record_type'] == 'REFERENCE_ROW':
            continue
        ident = r['legacy_id']
        if ident is None or ident == '':
            issues.append(issue(r, 'IMPORT_MISSING_REQUIRED_SOURCE_VALUE', 'legacy identifier'))
        else:
            if not re.fullmatch(r'[\w-]+', str(ident)):
                issues.append(issue(r, 'IMPORT_INVALID_IDENTIFIER', str(ident)))
            grouped[(r['record_type'], str(ident))].append(r)
        sku = r['normalized_payload'].get('SKU')
        if sku is not None and sku != '':
            grouped[(r['record_type'] + '.SKU', str(sku))].append(r)
            if not re.fullmatch(r'[\w#-]+', str(sku)):
                issues.append(issue(r, 'IMPORT_INVALID_IDENTIFIER', 'SKU=' + str(sku)))
    for group in grouped.values():
        if len(group) > 1:
            issues.extend(issue(r, 'IMPORT_DUPLICATE_IDENTIFIER', str(r['legacy_id'])) for r in group)
    return issues


def duplicate_kind(a, b):
    a, b = key(a), key(b)
    if a == b and a:
        return 'EXACT_DUPLICATE', ['same normalized name']
    tokens = lambda s: {w.rstrip('s') for w in re.findall(r'\w+', s) if w not in ('de', 'para', 'con', 'the')}
    x, y = tokens(a), tokens(b)
    hardware = {'stand', 'estructura', 'hardware', 'grafica', 'complete', 'completo', 'replacement'}
    if (({'x', 'banner'} <= x & y) or ({'feather', 'flag'} <= x & y)) and ((x | y) & hardware):
        return 'RELATIONSHIP_NOT_DUPLICATE', ['shared display family; different component roles']
    methods = {'uv', 'dtf', 'bordado', 'serigrafia', 'htv'}
    if x - methods and x - methods == y - methods and (x ^ y) & methods:
        return 'PROBABLE_DUPLICATE', ['same object after removing method tokens; method is not identity']
    if x and (x == y or len(x & y) / len(x | y) >= .7):
        return 'PROBABLE_DUPLICATE', ['token overlap >= 0.70']
    return None, []


def duplicates(records):
    items = [r for r in records if r['record_type'] == 'OFERTAS' and not r['synthetic'] and r['legacy_id']]
    result = []
    for a, b in combinations(items, 2):
        kind, signals = duplicate_kind(a['normalized_payload'].get('Nombre'), b['normalized_payload'].get('Nombre'))
        if kind:
            result.append({'kind': kind, 'record_ids': [a['record_id'], b['record_id']],
                           'legacy_ids': [a['legacy_id'], b['legacy_id']], 'signals': signals,
                           'recommendation': 'Review independently; no automatic merge',
                           'source': a['source'] + b['source']})
    return result
