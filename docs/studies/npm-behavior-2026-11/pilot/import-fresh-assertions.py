"""Investigate retained assertions in disposable, offline gVisor containers."""
import hashlib
import json
import os
import platform
import runpy
import shlex
from pathlib import Path
from uuid import uuid4

import run as pilot

OUTPUT = Path('test-results/import-fresh-assertions.json')
DIAGNOSTIC = runpy.run_path(str(pilot.ROOT / 'import-fresh-diagnostic.py'))
CHECKS = runpy.run_path(str(pilot.ROOT.parent / 'followup/assertions-verify.py'))
SETUP = ('cp -R /workspace/. /study/; cd /study; '
         'cp -R /pilot/source/import-fresh/. node_modules/import-fresh/; '
         'cp -R node_modules/import-fresh import-fresh-suite; ')


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
    assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
    versions = pilot.validate_pins()
    image = pilot.build_image(json.loads((pilot.ROOT / 'source-suites.json').read_text()),
                              json.loads((pilot.ROOT / 'release-assets.json').read_text()), versions)
    volume = pilot.cli('docker', 'volume', 'create', f'compatlab-assertions-{uuid4().hex}')
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
            runner = [runtime] if runtime == 'node' else [runtime, 'run', '-A', '--no-config', '--no-lock', '--node-modules-dir=manual', '--cached-only']
            cases = [('builtin-sync-repro.mjs', []), ('loader-error-repro.mjs', []), ('registration-count-repro.mjs', [])]
            cases += [('import-attributes-repro.mjs', [mode]) for mode in ('direct', 'hook', 'package')]
            for attempt in (1, 2):
                for script, args in cases:
                    label = f'{runtime} {script} {" ".join(args)}'.strip() + f' / attempt {attempt}'
                    row = pilot.measure(image, volume, label, SETUP + shlex.join([*runner, '/pilot/' + script, *args]), deadline=30)
                    receipt['results'].append(row)
                    CHECKS['check_reduction'](row, runtime, script, args)
                    print(label, json.dumps(row['suiteResult']), flush=True)
            for fail in (False, True):
                label = f'{runtime} sync control fail={fail}'
                row = pilot.measure(image, volume, label, SETUP + f'SKIP_PATCH=1 FAIL_CONTROL={int(fail)} ' + shlex.join([*runner, '/pilot/builtin-sync-repro.mjs']), deadline=15)
                receipt['results'].append(row)
                CHECKS['check_control'](row, fail)
            test_runner = ['node', '--test', '--test-reporter=tap'] if runtime == 'node' else [runtime, *DIAGNOSTIC['DENO_TEST'][1:]]
            for filename, names in inventory.items():
                row = pilot.measure(image, volume, f'{runtime} context-bound suite / {filename}',
                    SETUP + 'node /pilot/import-fresh-repro.mjs bind-tests; ' + shlex.join([*test_runner, './import-fresh-suite/tests/' + filename]), deadline=60)
                receipt['results'].append(row)
                row['tap'] = DIAGNOSTIC['tap_report'](row, names)
                assert row['tap']['complete']
                expected = [inventory['test.js'][index - 1] for index in (27, 52, 53, 54)] if runtime != 'node' and filename == 'test.js' else []
                assert row['tap']['failures'] == expected
        CHECKS['verify_observations'](receipt)
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
