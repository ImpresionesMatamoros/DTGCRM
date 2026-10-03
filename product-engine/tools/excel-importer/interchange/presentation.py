"""Presentation evidence candidates (STEP 05B).

STEP 05A kept PRESENTACIONES / PRESENTACIÓN_OFERTA as raw evidence only. A
presentation candidate is produced per PRESENTACIÓN_OFERTA link row, joined
explicitly to exactly one PRESENTACIONES row and one OFERTAS row. Values are
copied literally; nothing is inferred (no locale, no default flag, no
publication). TEST rows never produce candidates.
"""
from parser.reader import stable_id
from parser.validation import issue


def _real(records, table):
    return [r for r in records
            if r['record_type'] == table and not r['synthetic'] and r['legacy_id']]


def presentation_candidates(records):
    presentations = _real(records, 'PRESENTACIONES')
    offers = _real(records, 'OFERTAS')
    candidates, issues = [], []
    for link in _real(records, 'PRESENTACIÓN_OFERTA'):
        p = link['normalized_payload']
        pres = [r for r in presentations
                if p.get('Presentación_ID') is not None
                and r['normalized_payload'].get('Presentación_ID') == p.get('Presentación_ID')]
        items = [r for r in offers
                 if p.get('Oferta_ID') is not None
                 and r['normalized_payload'].get('Oferta_ID') == p.get('Oferta_ID')]
        if len(pres) != 1:
            issues.append(issue(link, 'IMPORT_UNRESOLVED_REFERENCE',
                                f"PRESENTACIONES.Presentación_ID={p.get('Presentación_ID')}: {len(pres)} matches"))
        if len(items) != 1:
            issues.append(issue(link, 'IMPORT_UNRESOLVED_REFERENCE',
                                f"OFERTAS.Oferta_ID={p.get('Oferta_ID')}: {len(items)} matches"))
        head = pres[0]['normalized_payload'] if len(pres) == 1 else {}
        if head.get('Idioma') in (None, ''):
            issues.append(issue(link, 'IMPORT_DOMAIN_MAPPING_QUESTION',
                                'Presentation language not in source; locale requires review'))
        refs = pres + items
        candidates.append({
            'candidate_id': stable_id(link['record_id'], 'presentation'),
            'kind': 'presentation',
            'record_ids': [link['record_id']] + [r['record_id'] for r in refs],
            'data': {
                'link_legacy': link['legacy_id'],
                'presentation_legacy': p.get('Presentación_ID'),
                'item_legacy': p.get('Oferta_ID'),
                'commercial_name': head.get('Nombre_comercial'),
                'audience_or_use': head.get('Audiencia_o_uso'),
                'channel': head.get('Canal'),
                'language': head.get('Idioma'),
                'publication_state_evidence': head.get('Estado_de_publicación'),
                'role': p.get('Rol'),
                'order': p.get('Orden'),
                'suggested_quantity': p.get('Cantidad_sugerida'),
                'notes_evidence': head.get('Notas'),
            },
            'source': link['source'] + [c for r in refs for c in r['source']],
            'workflow_state': 'PENDING_REVIEW', 'publishable': False,
            'validation_state': 'VALID', 'issue_ids': [],
            'review': ['Presentation evidence; locale, default flag and publication require human review'],
        })
    return candidates, issues
