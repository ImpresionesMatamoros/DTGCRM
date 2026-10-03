"""Known catalog tables use asserted headers; other sheets remain complete raw evidence."""
from .reader import stable_id
from .normalizers import text

TABLES = {
    'OFERTAS': ('Oferta_ID', 16), 'OPCIONES_OFERTA': ('Opción_ID', 11),
    'OFERTA_METODO': ('Oferta_Método_ID', 6), 'PRECIOS': ('Precio_ID', 23),
    'CONDICIONES_PRECIO': ('Condición_ID', 8), 'COMPONENTES_OFERTA': ('Componente_ID', 9),
    'FUENTES_OFERTA': ('Fuente_ID', 15), 'PRESENTACIONES': ('Presentación_ID', 7),
    'PRESENTACIÓN_OFERTA': ('Presentación_Oferta_ID', 7), 'LISTAS': ('Valor_ID', 7),
    'INSUMOS': ('Insumo_ID', 8), 'COSTOS_INSUMO': ('Costo_Insumo_ID', 18),
    'RECETAS_OFERTA': ('Receta_ID', 16), 'CONSUMO_OFERTA': ('Consumo_ID', 9)}


def records(profile, rows, batch_id):
    by_sheet = {}
    for row in rows:
        by_sheet.setdefault(row['source_sheet'], []).append(row)
    result, issues = [], []
    for name, entries in by_sheet.items():
        config = TABLES.get(name)
        headers = {}
        header_row = None
        if config:
            for row in entries[:10]:
                names = [c['raw_value'] for c in row['cells'] if not c['formula']]
                if config[0] in names:
                    header_row = row['source_row']
                    headers = {c['source_column']: c['raw_value'] for c in row['cells']
                               if c['source_column'] <= config[1] and isinstance(c['raw_value'], str)}
                    break
            if header_row is None:
                issues.append({'code': 'IMPORT_HEADER_MISMATCH', 'severity': 'ERROR',
                               'message': 'Expected identifier header missing: ' + config[0],
                               'record_id': None, 'source': entries[0]['cells'][:1]})
        for row in entries:
            cells = row['cells']
            if not any(not c['formula'] for c in cells):
                continue  # formula-only scaffolding is already fully in workbook profile
            table = bool(headers and row['source_row'] > header_row)
            selected = [c for c in cells if c['source_column'] in headers] if table else cells
            payload = {headers[c['source_column']] if table else c['source_cell']: c['raw_value'] for c in selected}
            normalized = {headers[c['source_column']] if table else c['source_cell']: c['normalized_value'] for c in selected}
            if table and not any(v is not None and v != '' for v in normalized.values()):
                continue
            if table:
                # Explicit nulls retain the source locations of missing required values.
                for column, field in headers.items():
                    if field not in payload:
                        from openpyxl.utils import get_column_letter
                        ref = dict(cells[0], source_column=column,
                                   source_cell=f'{get_column_letter(column)}{row["source_row"]}',
                                   raw_value=None, normalized_value=None, data_type='n', formula=None,
                                   cached_value=None, number_format='General')
                        selected.append(ref)
                        payload[field] = normalized[field] = None
            legacy = normalized.get(config[0]) if table else None
            synthetic = any(isinstance(v, str) and v.startswith('TEST-') for k, v in normalized.items()
                            if k.endswith('_ID')) or (isinstance(legacy, str) and legacy.startswith('TEST-'))
            # A partly completed row without an ID is still retained and validated.
            result.append({'record_id': stable_id(profile['sha256'], name, row['source_row']),
                           'batch_id': batch_id, 'record_type': name if table else 'REFERENCE_ROW',
                           'legacy_id': legacy, 'synthetic': synthetic,
                           'raw_payload': payload, 'normalized_payload': normalized,
                           'source': sorted(selected + [c for c in cells if c not in selected], key=lambda c: c['source_column']), 'issues': []})
    return result, issues
