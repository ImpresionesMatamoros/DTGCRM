"""Verify supplied package checksums and run tests. Does not edit any source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from parser.pipeline import dump, PRIMARY
from parser.validation import TAXONOMY


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify(package):
    root = Path(__file__).resolve().parent
    package = Path(package).resolve()
    checks = []
    for line in (package / 'CHECKSUMS_SHA256.txt').read_text(encoding='utf8').splitlines():
        expected, relative = line.split(maxsplit=1)
        target = (package / relative.strip()).resolve()
        if package not in target.parents:
            raise ValueError('Manifest path outside package')
        actual = sha(target)
        checks.append({'file': relative, 'expected': expected, 'actual': actual, 'match': actual == expected})
    dump(root / 'evidence/input-checksums.json', checks)
    if not all(c['match'] for c in checks):
        raise RuntimeError('Input checksum mismatch')
    env = dict(os.environ, DTG_SOURCES=str(package / '02_SOURCE_WORKBOOKS'), PYTHONUTF8='1')
    p = subprocess.run([sys.executable, '-X', 'utf8', '-m', 'unittest', 'discover', '-s', 'tests', '-v'],
                       cwd=root, env=env, capture_output=True, text=True, encoding='utf8')
    (root / 'evidence/test-results.txt').write_text(p.stdout + p.stderr, encoding='utf8')
    summary = json.loads((root / 'evidence/summary.json').read_text(encoding='utf8'))
    final_checks = all(sha(package / c['file']) == c['expected'] for c in checks)
    audit = {'tests_exit_code': p.returncode, 'input_manifest_matches': all(c['match'] for c in checks),
             'all_package_sources_unchanged_after_tests': final_checks,
             'primary_counts': summary['primary_counts_by_table'], 'candidate_kinds': summary['candidate_kinds'],
             'historical_prices_excluded': summary['historical_prices'],
             'schema_or_production_persistence_implemented': False,
             'status_vocabulary': 'STEP03_HYPOTHESIS_ONLY; Q-01 OPEN',
             'unknown_boolean_default': None,
             'determinism': 'Full primary result equality tested; execution timestamps excluded',
             'classification': 'PASS WITH P1 OPEN ITEMS — READY TO ADAPT TO STEP 04 CONTRACTS'
                 if p.returncode == 0 and final_checks else 'FAIL — IMPORT DISCOVERY REQUIRES REVISION'}
    dump(root / 'evidence/self-audit.json', audit)
    lines = ['# Import error taxonomy', '', 'Stable codes implemented in `parser/validation.py`.', '',
             '| Code | Severity | Meaning |', '|---|---|---|']
    for code, (severity, message) in TAXONOMY.items():
        lines.append(f'| {code} | {severity} | {message} |')
    lines += ['', 'CURRENCY_UNKNOWN in the brief maps to IMPORT_UNKNOWN_CURRENCY. '
              'DOMAIN_MAPPING_QUESTION maps to IMPORT_DOMAIN_MAPPING_QUESTION. '
              'VARIANT_MATERIALIZATION_CANDIDATE is a review signal, never a variant creation instruction.', '',
              'Every issue has message, source and record_id (null only before header resolution). '
              'issue_id hashes record/code/detail when a record is available. Candidate issue_ids include dependency issues. '
              'ERROR marks technical rejection; WARNING requires review; INFO carries a non-authorizing observation. '
              'No severity bypasses human approval.', '']
    (root / 'IMPORT-ERROR-TAXONOMY.md').write_text('\n'.join(lines), encoding='utf8')
    print(json.dumps(audit, ensure_ascii=False, indent=2))
    return p.returncode


if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('--package', required=True, type=Path)
    sys.exit(verify(cli.parse_args().package))
