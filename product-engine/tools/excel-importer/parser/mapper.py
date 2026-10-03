"""Conceptual hypotheses only; no STEP 04 types, IDs, tables or publish state are assumed."""
from collections import defaultdict
import json
from .normalizers import text, key, boolean, quantity, money, measurement
from .reader import stable_id
from .validation import issue

STATUS_HYPOTHESES = {'activo': 'ACTIVE', 'candidato': 'CANDIDATE', 'planeado': 'PLANNED', 'retirado': 'RETIRED'}
UNITS = {'pieza': 'PIECE', 'par': 'PAIR', 'juego': 'SET', 'hoja': 'SHEET', 'pie2': 'SQ_FT', 'pie lineal': 'LINEAR_FT'}


def map_candidates(records):
    real = [r for r in records if not r['synthetic'] and r['record_type'] != 'REFERENCE_ROW' and r['legacy_id']]
    tables = defaultdict(list)
    for r in real:
        tables[r['record_type']].append(r)
    candidates, historical, issues = [], [], []

    def targets(table, field, value):
        return [r for r in tables[table] if r['normalized_payload'].get(field) == value and value is not None]

    def link(r, table, field, value, required=True):
        found = targets(table, field, value)
        if required and len(found) != 1:
            issues.append(issue(r, 'IMPORT_UNRESOLVED_REFERENCE', f'{table}.{field}={value}: {len(found)} matches'))
        return found

    def add(r, kind, data, refs=None):
        candidates.append({'candidate_id': stable_id(r['record_id'], kind), 'kind': kind,
                           'record_ids': [r['record_id']] + [v['record_id'] for v in (refs or [])],
                           'data': data, 'source': r['source'] + [c for v in (refs or []) for c in v['source']],
                           'workflow_state': 'PENDING_REVIEW', 'publishable': False,
                           'validation_state': 'VALID', 'issue_ids': [],
                           'review': ['Conceptual hypothesis; STEP 04 contract adaptation and human approval required']})

    for r in real:
        p = r['normalized_payload']
        typ = r['record_type']
        if typ == 'OFERTAS':
            status = STATUS_HYPOTHESES.get(key(p.get('Estado_comercial')))
            if status is None:
                issues.append(issue(r, 'IMPORT_UNKNOWN_STATUS'))
            if not p.get('Nombre'):
                issues.append(issue(r, 'IMPORT_MISSING_REQUIRED_SOURCE_VALUE', 'Nombre'))
            category = targets('LISTAS', 'Valor_ID', p.get('Categoría_ID'))
            issues.append(issue(r, 'IMPORT_UNMAPPED_CATEGORY', str(p.get('Categoría_ID'))))
            item_type = {'bien': 'PRODUCT', 'servicio': 'SERVICE', 'bundle': 'BUNDLE'}.get(key(p.get('Clase')))
            if item_type is None:
                issues.append(issue(r, 'IMPORT_DOMAIN_MAPPING_QUESTION', 'Unmapped Clase: ' + str(p.get('Clase'))))
            unit = UNITS.get(key(p.get('Unidad_predeterminada')))
            if r['legacy_id'] in ('MIG1-O-008', 'MIG1-O-009', 'MIG2-O-036') and key(p.get('Unidad_predeterminada')) == 'paquete':
                unit = 'PIECE'  # approved STEP 03 migration mapping §1; exact packages remain price conditions
            if unit is None:
                issues.append(issue(r, 'IMPORT_DOMAIN_MAPPING_QUESTION', 'Sale unit unknown/unmapped'))
            add(r, 'catalog_item', {'legacy_id': r['legacy_id'], 'legacy_sku': p.get('SKU'),
                                  'name': p.get('Nombre'), 'item_type_hypothesis': item_type,
                                  'catalog_status_hypothesis': status, 'sale_unit_hypothesis': unit,
                                  'category_legacy': p.get('Categoría_ID'), 'family_evidence': p.get('Familia_ID'),
                                  'customer_supplied_evidence': boolean(p.get('Acepta_material_cliente')),
                                  'notes_evidence': p.get('Notas')}, category)
        elif typ == 'OPCIONES_OFERTA':
            parents = link(r, 'OFERTAS', 'Oferta_ID', p.get('Oferta_ID'))
            values = targets('LISTAS', 'Lista_ID', p.get('Lista_ID'))
            name = key(p.get('Nombre_de_opción'))
            if r['legacy_id'] == 'OWN-OP-007':
                issues.append(issue(r, 'IMPORT_DOMAIN_MAPPING_QUESTION', 'Gorra clothing size excluded by STEP 03; evidence only'))
                continue
            if r['legacy_id'] in ('MIGF-OP-001', 'OWN-OP-009', 'OWN-OP-010'):
                # Approved STEP 03 §1/§2: single-value attributes, not configurable options.
                issues.append(issue(r, 'IMPORT_DOMAIN_MAPPING_QUESTION', 'Single-value item attribute; STEP 05B must bind to item, not Option'))
                for parent in candidates:
                    if parent['kind'] == 'catalog_item' and parent['data']['legacy_id'] == p.get('Oferta_ID'):
                        parent['data'].setdefault('fixed_attribute_evidence', []).append({
                            'name': p.get('Nombre_de_opción'), 'values': [v['normalized_payload'].get('Etiqueta') for v in values],
                            'record_id': r['record_id']})
                        parent['record_ids'].extend([r['record_id']] + [v['record_id'] for v in values])
                        parent['source'].extend(r['source'] + [s for v in values for s in v['source']])
                continue
            if name == 'modalidad':
                labels = {key(v['normalized_payload'].get('Etiqueta')) for v in values}
                kind = 'decoration' if labels & {'blank', 'personalizada'} else 'composition'
                issues.append(issue(r, 'IMPORT_DOMAIN_MAPPING_QUESTION', 'modalidad transformed; never a generic option'))
                add(r, kind, {'subtype': 'policy_hypothesis', 'item_legacy': p.get('Oferta_ID'),
                             'raw_option': p, 'value_evidence': [v['normalized_payload'] for v in values]}, parents + values)
                continue
            if key(p.get('Tipo_de_captura')) == 'lista' and not values:
                issues.append(issue(r, 'IMPORT_UNRESOLVED_REFERENCE', 'Lista_ID=' + str(p.get('Lista_ID'))))
            issues.append(issue(r, 'IMPORT_UNMAPPED_OPTION', name))
            add(r, 'option', {'item_legacy': p.get('Oferta_ID'), 'name': p.get('Nombre_de_opción'),
                              'capture_type': p.get('Tipo_de_captura'), 'required': boolean(p.get('Obligatoria')),
                              'values': [{'label': v['normalized_payload'].get('Etiqueta'),
                                          'measurement': measurement(v['normalized_payload'].get('Etiqueta')),
                                          'record_id': v['record_id']} for v in values]}, parents + values)
        elif typ == 'OFERTA_METODO':
            parents = link(r, 'OFERTAS', 'Oferta_ID', p.get('Oferta_ID'))
            methods = link(r, 'LISTAS', 'Valor_ID', p.get('Método_ID'))
            issues.append(issue(r, 'IMPORT_DOMAIN_MAPPING_QUESTION', 'Production method association does not prove selectable decoration'))
            add(r, 'decoration', {'subtype': 'method_association', 'item_legacy': p.get('Oferta_ID'),
                                  'method_legacy': p.get('Método_ID'),
                                  'method_labels': [v['normalized_payload'].get('Etiqueta') for v in methods]}, parents + methods)
        elif typ == 'COMPONENTES_OFERTA':
            refs = link(r, 'OFERTAS', 'Oferta_ID', p.get('Oferta_padre_ID')) + link(r, 'OFERTAS', 'Oferta_ID', p.get('Oferta_componente_ID'))
            q = quantity(p.get('Cantidad'))
            if q['kind'] != 'EXACT':
                issues.append(issue(r, 'IMPORT_INVALID_QUANTITY'))
            role = {'incluido': 'INCLUDED', 'opcional': 'OPTIONAL'}.get(key(p.get('Rol')))
            if role is None or p.get('Oferta_padre_ID') == p.get('Oferta_componente_ID'):
                issues.append(issue(r, 'IMPORT_DOMAIN_MAPPING_QUESTION', 'Composition role/self-reference requires review'))
            add(r, 'composition', {'parent_legacy': p.get('Oferta_padre_ID'), 'child_legacy': p.get('Oferta_componente_ID'),
                                   'quantity': q, 'role_hypothesis': role}, refs)
        elif typ == 'PRECIOS':
            refs = link(r, 'OFERTAS', 'Oferta_ID', p.get('Oferta_ID'))
            cond = targets('CONDICIONES_PRECIO', 'Precio_ID', r['legacy_id'])
            cash = money(p.get('Importe'), p.get('Moneda'))
            for code in cash['issues']:
                issues.append(issue(r, code))
            authorized_evidence = key(p.get('Estado_de_precio')) == 'confirmado' and boolean(p.get('Revisado')) is True
            notes = key(p.get('Notas'))
            historical_evidence = 'no autorizado' in notes or 'historico' in notes
            low, high = quantity(p.get('Cantidad_desde')), quantity(p.get('Cantidad_hasta'))
            model = key(p.get('Modelo'))
            classification = 'UNKNOWN_REVIEW_REQUIRED'
            if historical_evidence:
                classification = 'HISTORICAL_EVIDENCE_ONLY'
            elif authorized_evidence and model == 'por tabla' and low['kind'] == high['kind'] == 'EXACT' and low['value'] == high['value']:
                classification = 'EXACT_QUANTITY_MATRIX'
            elif authorized_evidence and model in ('fijo', 'total', 'fijo/total'):
                classification = 'FIXED'
            else:
                issues.append(issue(r, 'IMPORT_DOMAIN_MAPPING_QUESTION', 'Unmapped source price model: ' + str(p.get('Modelo'))))
            if model == 'por tabla' and classification != 'HISTORICAL_EVIDENCE_ONLY' and classification != 'EXACT_QUANTITY_MATRIX':
                issues.append(issue(r, 'IMPORT_INVALID_QUANTITY', 'Matrix requires equal explicit quantity bounds'))
            if cash['issues']:
                if classification != 'HISTORICAL_EVIDENCE_ONLY':
                    classification = 'UNKNOWN_REVIEW_REQUIRED'
            for c in cond:
                cp = c['normalized_payload']
                link(c, 'OPCIONES_OFERTA', 'Opción_ID', cp.get('Opción_ID'))
                if key(cp.get('Operador')) != 'igual':
                    issues.append(issue(r, 'IMPORT_DOMAIN_MAPPING_QUESTION', 'Unsupported price condition operator'))
                    if classification != 'HISTORICAL_EVIDENCE_ONLY':
                        classification = 'UNKNOWN_REVIEW_REQUIRED'
            data = {'item_legacy': p.get('Oferta_ID'), 'price_legacy': r['legacy_id'],
                    'classification': classification, 'money': cash, 'source_model': p.get('Modelo'),
                    'quantity_from': low, 'quantity_to': high, 'amount_basis_evidence': p.get('Base_de_cobro'),
                    'conditions': [c['normalized_payload'] for c in cond],
                    'authorization_evidence': authorized_evidence, 'current': False,
                    'mexico_evidence': 'MANUAL_OR_UNKNOWN_REVIEW_REQUIRED' if cash['currency'] == 'MXN' else None}
            if classification == 'HISTORICAL_EVIDENCE_ONLY':
                historical.append({'record_id': r['record_id'], 'data': data, 'source': r['source'] + [s for c in cond for s in c['source']]})
            else:
                add(r, 'price', data, refs + cond)
        elif typ == 'FUENTES_OFERTA' and p.get('Código_proveedor'):
            issues.append(issue(r, 'VARIANT_MATERIALIZATION_CANDIDATE', 'Review sourcing identity; do not generate variants'))
    # Price conflicts are scoped by semantic conditions, not changing row/condition IDs.
    prices = defaultdict(list)
    for c in candidates:
        if c['kind'] != 'price':
            continue
        d = c['data']
        conds = sorted((str(x.get('Atributo_controlado')), str(x.get('Operador')), str(x.get('Valor')), str(x.get('Unidad'))) for x in d['conditions'])
        signature = json.dumps([d['item_legacy'], d['money']['currency'], d['quantity_from'], d['quantity_to'],
                                d['amount_basis_evidence'], conds], sort_keys=True)
        prices[signature].append(c)
    indexed = {r['record_id']: r for r in records}
    for group in prices.values():
        if len({c['data']['money']['amount'] for c in group}) > 1:
            issues.extend(issue(indexed[c['record_ids'][0]], 'IMPORT_PRICE_CONFLICT') for c in group)
    return candidates, historical, issues
