"""Follow-up observations; never replace the frozen study's original receipts."""
import hashlib
import json
import os
import platform
import re
import shlex
from pathlib import Path
from uuid import uuid4

import run as pilot

OUTPUT = Path('test-results/import-fresh-diagnostic.json')
SETUP = ('cp -R /workspace/. /study/; cd /study; '
         'cp -R /pilot/source/import-fresh/. node_modules/import-fresh/; '
         'cp -R node_modules/import-fresh import-fresh-suite; ')
DENO_TEST = ['deno', 'test', '-A', '--no-config', '--no-lock', '--node-modules-dir=manual', '--cached-only', '--no-check', '--reporter=tap']


def tap_report(row, names):
    log = row['stdoutAndStderr']
    entries = re.findall(r'(?m)^(ok|not ok) (\d+) - (.+)$', log)
    plans = re.findall(r'(?m)^1\.\.(\d+)$', log)
    failed = sum(status == 'not ok' for status, _, _ in entries)
    complete = (
        [name for _, _, name in entries] == names
        and [int(number) for _, number, _ in entries] == list(range(1, len(names) + 1))
        and plans == [str(len(names))]
        and row['exitCode'] == (1 if failed else 0)
        and not any(row[field] for field in ('timedOut', 'outOfMemory', 'containerError', 'logTruncated'))
    )
    return {'complete': complete, 'planned': len(names), 'passed': len(entries) - failed,
            'failed': failed, 'failures': [name for status, _, name in entries if status == 'not ok']}


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
    assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
    versions = pilot.validate_pins()
    sources = json.loads((pilot.ROOT / 'source-suites.json').read_text())
    assets = json.loads((pilot.ROOT / 'release-assets.json').read_text())
    image = pilot.build_image(sources, assets, versions)
    volume = pilot.cli('docker', 'volume', 'create', f'compatlab-import-fresh-{uuid4().hex}')
    receipt = {'schemaVersion': 1, 'startedAt': pilot.now(), 'sourceCommit': os.environ['GITHUB_SHA'],
               'runUrl': f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
               'image': image, 'runsc': pilot.cli('runsc', '--version'),
               'lockSha256': hashlib.sha256((pilot.ROOT / 'package-lock.json').read_bytes()).hexdigest(),
               'platform': 'Linux amd64 / Debian Bookworm / glibc', 'results': []}
    try:
        receipt['versions'] = pilot.measure(image, volume, 'versions', 'node --version; deno --version; deno298 --version')
        assert pilot.successful(receipt['versions'])
        pins = receipt['versions']['stdoutAndStderr'].splitlines()
        assert pins[0] == 'v26.10.0' and pins[1].startswith('deno 2.9.7 ') and pins[4].startswith('deno 2.9.8 ')
        receipt['preparation'] = pilot.measure(image, volume, 'locked install',
            'npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org',
            writable_seed=True, connected=True, deadline=120)
        assert pilot.successful(receipt['preparation'])
        inventory = json.loads((pilot.ROOT / 'import-fresh-tests.json').read_text())
        for runtime in ('node', 'deno', 'deno298'):
            runner = ['node', '--test', '--test-reporter=tap'] if runtime == 'node' else [runtime, *DENO_TEST[1:]]
            for bound, fail in ((False, False), (True, False), (True, True)):
                command = SETUP + f'BIND_CONTEXT={int(bound)} FAIL_CONTROL={int(fail)} ' + shlex.join(runner + ['/pilot/async-context-repro.mjs'])
                row = pilot.measure(image, volume, f'{runtime} minimal context bound={bound} fail={fail}', command, deadline=15)
                receipt['results'].append(row)
                row['tap'] = tap_report(row, ['first context finishes', 'second context starts empty'])
                assert row['tap']['complete'], row['label']
                assert row['tap']['failed'] == int(fail or (runtime != 'node' and not bound)), row['label']
            for bound in (False, True):
                command = SETUP + 'cp /pilot/import-fresh-test-repro.mjs /study/repro.test.mjs; ' + f'REPRO_MODE=package BIND_CONTEXT={int(bound)} ' + shlex.join(runner + ['/study/repro.test.mjs'])
                row = pilot.measure(image, volume, f'{runtime} two imports bound={bound}', command, deadline=15)
                receipt['results'].append(row)
                assert row['timedOut'] == (runtime != 'node' and not bound), row['label']
                if not row['timedOut']:
                    row['tap'] = tap_report(row, ['first import', 'nested import'])
                    assert row['tap']['complete'] and row['tap']['failed'] == 0, row['label']
            for attempt in (1, 2):
                for name, names in inventory.items():
                    command = SETUP + 'node /pilot/import-fresh-repro.mjs bind-tests; ' + shlex.join(runner + ['./import-fresh-suite/tests/' + name])
                    row = pilot.measure(image, volume, f'{runtime} context-bound suite / {name} / attempt {attempt}', command, deadline=60)
                    receipt['results'].append(row)
                    row['tap'] = tap_report(row, names)
                    assert row['tap']['complete'], row['label']
                    if runtime == 'node':
                        assert row['tap']['failed'] == 0, row['label']
                    print(f"{row['label']}: {row['tap']['passed']} passed, {row['tap']['failed']} failed", flush=True)
            OUTPUT.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT.write_text(json.dumps(receipt, indent=2) + '\n')
    except Exception as error:
        receipt['infrastructureError'] = str(error)
        raise
    finally:
        receipt['completedAt'] = pilot.now()
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(receipt, indent=2) + '\n')
        pilot.cli('docker', 'volume', 'rm', volume)


if __name__ == '__main__':
    main()
