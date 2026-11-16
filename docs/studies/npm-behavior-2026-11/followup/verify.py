"""Verify follow-up coverage without executing candidate code."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def tap(row, names):
    entries = re.findall(r'(?m)^(ok|not ok) (\d+) - (.+)$', row['stdoutAndStderr'])
    assert [name for _, _, name in entries] == names, row['label']
    assert [int(number) for _, number, _ in entries] == list(range(1, len(names) + 1))
    assert re.findall(r'(?m)^1\.\.(\d+)$', row['stdoutAndStderr']) == [str(len(names))]
    failed = [name for status, _, name in entries if status == 'not ok']
    assert row['exitCode'] == int(bool(failed))
    assert not any(row[field] for field in ('timedOut', 'outOfMemory', 'containerError', 'logTruncated'))
    assert row['network'] == 'none'
    assert row['tap'] == {'complete': True, 'planned': len(names), 'passed': len(names) - len(failed), 'failed': len(failed), 'failures': failed}
    return failed


def verify():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    for item in manifest['files']:
        data = (ROOT / item['file']).read_bytes()
        assert hashlib.sha256(data).hexdigest() == item['sha256'], item['file']
        run = json.loads(data)
        assert run['sourceCommit'] == item['sourceCommit'] and run['runUrl'] == item['runUrl']
        assert run.get('completedAt') and not run.get('infrastructureError')
    run = json.loads((ROOT / 'verification.json').read_text())
    assert hashlib.sha256((ROOT.parent / 'pilot/package-lock.json').read_bytes()).hexdigest() == run['lockSha256']
    rows = {row['label']: row for row in run['results']}
    assert len(rows) == len(run['results']) == 38
    inventory = json.loads((ROOT.parent / 'pilot/import-fresh-tests.json').read_text())
    assert [len(names) for names in inventory.values()] == [65, 4]
    totals = {}
    for runtime in ('node', 'deno', 'deno298'):
        for bound, fail, skip_import in ((False, False, False), (False, False, True), (True, False, False), (True, True, False)):
            label = f'{runtime} minimal context bound={bound} fail={fail} skip_import={skip_import}'
            failed = tap(rows[label], ['first context finishes', 'second context starts empty'])
            expected = fail or (runtime != 'node' and not bound and not skip_import)
            assert failed == (['second context starts empty'] if expected else [])
        for bound in (False, True):
            row = rows[f'{runtime} two imports bound={bound}']
            if runtime != 'node' and not bound:
                assert row['timedOut'] and row['exitCode'] != 0
                assert row['suiteResult'] == {'events': ['first passed', 'nested started']}
            else:
                assert not tap(row, ['first import', 'nested import'])
        attempts = []
        failure_names = []
        for attempt in (1, 2):
            failures = []
            for name, names in inventory.items():
                failures.extend(tap(rows[f'{runtime} context-bound suite / {name} / attempt {attempt}'], names))
            attempts.append({'completed': 69, 'passed': 69 - len(failures), 'failed': len(failures)})
            failure_names.append(failures)
        assert attempts[0] == attempts[1] and failure_names[0] == failure_names[1]
        totals[runtime] = attempts[0]
        if runtime == 'node':
            assert failure_names[0] == []
        else:
            assert failure_names[0] == [inventory['test.js'][index - 1] for index in (27, 52, 53, 54)]
            for name in failure_names[0]:
                assert tap(rows[runtime + ' isolated original / ' + name], [name]) == [name]
    return totals


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
