"""Neutral interpretations. Raw input is always retained by the reader."""
import re
import unicodedata
from decimal import Decimal, InvalidOperation


def text(value):
    if not isinstance(value, str):
        return value
    return ''.join(c for c in value if unicodedata.category(c) != 'Cf').replace('\xa0', ' ').strip()


def key(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(text(value) or ''))
                   if not unicodedata.combining(c)).casefold()


def boolean(value):
    k = key(value)
    if k in ('si', 'yes', 'true') or value is True:
        return True
    if k in ('no', 'false') or value is False:
        return False
    return None


def quantity(value):
    if value is None or text(value) == '':
        return {'kind': 'UNKNOWN', 'value': None}
    s = str(text(value))
    if isinstance(value, bool):
        return {'kind': 'AMBIGUOUS', 'value': None}
    if re.fullmatch(r'\d+(?:\.0+)?', s) and Decimal(s) > 0:
        return {'kind': 'EXACT', 'value': int(Decimal(s))}
    m = re.fullmatch(r'(\d+)\s*[-–]\s*(\d+)', s)
    if m and 0 < int(m[1]) <= int(m[2]):
        return {'kind': 'RANGE', 'min': int(m[1]), 'max': int(m[2])}
    m = re.fullmatch(r'(?:>=\s*|mínimo\s*|min\s*)(\d+)|(\d+)\+', s, re.I)
    if m and int(m[1] or m[2]) > 0:
        return {'kind': 'MINIMUM', 'min': int(m[1] or m[2])}
    return {'kind': 'AMBIGUOUS', 'value': None}


def money(value, currency=None):
    s = str(text(value) if value is not None else '')
    found = {('USD' if key(x) in ('usd', 'dlls') else 'MXN')
             for x in re.findall(r'\b(?:USD|MXN|dlls)\b', s, re.I)}
    explicit = str(text(currency) or '').upper()
    issues = []
    if explicit and explicit not in ('USD', 'MXN'):
        issues.append('IMPORT_UNKNOWN_CURRENCY')
    if explicit in ('USD', 'MXN'):
        found.add(explicit)
    code = next(iter(found)) if len(found) == 1 else None
    if len(found) > 1:
        issues.append('IMPORT_CURRENCY_CONFLICT')
    if not code:
        issues.append('IMPORT_UNKNOWN_CURRENCY')
    numeric = re.sub(r'\b(?:USD|MXN|dlls)\b|\$', '', s, flags=re.I).strip()
    # Deliberately reject ambiguous comma decimal forms; accept explicit thousands groups.
    if re.fullmatch(r'-?\d{1,3}(?:,\d{3})+(?:\.\d+)?', numeric):
        numeric = numeric.replace(',', '')
    amount = None
    if re.fullmatch(r'-?\d+(?:\.\d+)?', numeric) and not isinstance(value, bool):
        try:
            amount = format(Decimal(numeric), 'f')
        except InvalidOperation:
            pass
    if amount is None:
        issues.append('IMPORT_INVALID_MONEY')
    elif Decimal(amount) < 0:
        issues.append('IMPORT_INVALID_MONEY')
    return {'amount': amount, 'currency': code, 'issues': sorted(set(issues))}


def measurement(value):
    s = key(value).replace('×', 'x')
    single = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(in|inches|pulgadas|ft|feet|pies|cm|m|"|\')', s)
    units = {'inches': 'in', 'pulgadas': 'in', '"': 'in', 'feet': 'ft', 'pies': 'ft', "'": 'ft'}
    if single:
        return {'kind': 'LENGTH', 'value': single[1], 'unit': units.get(single[2], single[2]), 'raw': value}
    m = re.fullmatch(r'(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(in|inches|pulgadas|ft|feet|pies|cm|m|"|\')?', s)
    if not m:
        return {'kind': 'AMBIGUOUS', 'raw': value}
    return {'kind': 'DIMENSIONS', 'width': m[1], 'height': m[2],
            'unit': units.get(m[3], m[3]), 'raw': value}
