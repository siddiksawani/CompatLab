"""Check diagnostic completeness and retained failures without executing package code."""
import json
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def complete(row, exit_code):
    assert row['network'] == 'none' and row['exitCode'] == exit_code, row['label']
    assert not any(row[key] for key in ('timedOut', 'outOfMemory', 'containerError', 'logTruncated', 'suiteResultError', 'completionError')), row['label']
    assert row['suiteResult'] is not None, row['label']
    return row['suiteResult']


def check_control(row, fail):
    assert complete(row, int(fail)) == {'before': True, 'defaultChanged': False, 'namedChanged': False}


def check_reduction(row, runtime, script, args):
    node = runtime == 'node'
    expected_failure = script in ('builtin-sync-repro.mjs', 'loader-error-repro.mjs') and not node
    data = complete(row, int(expected_failure))
    if script == 'builtin-sync-repro.mjs':
        assert data == {'before': True, 'defaultChanged': True, 'namedChanged': node}
    elif script == 'loader-error-repro.mjs':
        assert data['rejected'] and data['sameError'] == node
        assert data['code'] == ('TRIAGE_ATTRIBUTE_REJECTED' if node else 'ERR_MODULE_NOT_FOUND')
        assert 'deliberate loader rejection' in data['message']
    elif script == 'registration-count-repro.mjs':
        assert data == {'registrations': 1, 'values': [1, 1, 1]}
    else:
        assert script == 'import-attributes-repro.mjs' and data['mode'] == args[0]
        assert [case['name'] for case in data['cases']] == ['empty', 'json', 'commonjs', 'unknown']
        for case in data['cases']:
            name = case['name']
            attributes = {} if name == 'empty' else ({'unknown': 'value'} if name == 'unknown' else {'type': name})
            assert case['attributes'] == attributes
            loaded = name == 'empty' or (not node and name == 'unknown' and args[0] != 'direct')
            assert case['loaded'] == loaded and case['executed'] == int(loaded)
            if loaded:
                assert 'error' not in case
                assert case['value'] == (1 if args[0] == 'hook' else {'value': 1})
            else:
                if node:
                    expected = 'TRIAGE_ATTRIBUTE_REJECTED' if args[0] == 'hook' else ('ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE' if name == 'json' else 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED')
                else:
                    expected = None if args[0] == 'direct' and name != 'json' else 'ERR_MODULE_NOT_FOUND'
                assert case['error']['code'] == expected
                assert case['error']['name'] == 'TypeError'
                if args[0] in ('hook', 'package'):
                    message = 'load-hook sentinel' if args[0] == 'hook' else f'Import attributes are not supported for the CommonJS module "file:///study/attribute-{name}.cjs".'
                    assert case['error']['message'] == (message if node else 'TypeError: ' + message)
            if args[0] == 'hook':
                assert [event['phase'] for event in case['events']] == ['resolve', 'load']
                assert case['events'][0]['attributes'] == (attributes if node else {})
                assert case['events'][1]['attributes'] == ({} if not node and name == 'unknown' else attributes)
            else:
                assert case['events'] == []


def verify_observations(run):
    assert not run.get('infrastructureError')
    rows = {row['label']: row for row in run['results']}
    assert len(rows) == len(run['results']) == 48
    inventory = json.loads((ROOT.parent / 'pilot/import-fresh-tests.json').read_text())
    tap = runpy.run_path(str(ROOT / 'verify.py'))['tap']
    for runtime in ('node', 'deno', 'deno298'):
        for attempt in (1, 2):
            for script, args in [('builtin-sync-repro.mjs', []), ('loader-error-repro.mjs', []), ('registration-count-repro.mjs', [])] + [('import-attributes-repro.mjs', [mode]) for mode in ('direct', 'hook', 'package')]:
                label = f'{runtime} {script} {" ".join(args)}'.strip() + f' / attempt {attempt}'
                check_reduction(rows[label], runtime, script, args)
        for fail in (False, True):
            check_control(rows[f'{runtime} sync control fail={fail}'], fail)
        for filename, names in inventory.items():
            failures = tap(rows[f'{runtime} context-bound suite / {filename}'], names)
            expected = [inventory['test.js'][index - 1] for index in (27, 52, 53, 54)] if runtime != 'node' and filename == 'test.js' else []
            assert failures == expected


if __name__ == '__main__':
    verify_observations(json.loads((ROOT / 'assertions.json').read_text()))
    print('48 assertion-triage measurements verified; original four Deno suite failures retained')
