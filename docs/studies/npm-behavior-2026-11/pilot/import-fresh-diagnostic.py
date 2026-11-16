"""Follow-up observations; never replace the frozen study's original receipts."""
import hashlib
import json
import os
import platform
import shlex
from pathlib import Path
from uuid import uuid4

import run as pilot

OUTPUT = Path('test-results/import-fresh-diagnostic.json')
SETUP = ('cp -R /workspace/. /study/; cd /study; '
         'cp -R /pilot/source/import-fresh/. node_modules/import-fresh/; '
         'cp -R node_modules/import-fresh import-fresh-suite; ')
DENO = ['deno', 'run', '-A', '--no-config', '--no-lock', '--node-modules-dir=manual', '--cached-only']
DENO_TEST = ['deno', 'test', '-A', '--no-config', '--no-lock', '--node-modules-dir=manual', '--cached-only', '--no-check', '--reporter=tap']


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
        cases = []
        for runtime in ('node', 'deno', 'deno298'):
            runner = ['node', '--test', '--test-reporter=tap'] if runtime == 'node' else [runtime, *DENO_TEST[1:]]
            for mode in ('plain', 'hook', 'package'):
                setup = SETUP + 'cp /pilot/import-fresh-test-repro.mjs /study/repro.test.mjs; '
                # Node's test runner consumes following arguments as files; configure via env instead.
                command = setup + f'REPRO_MODE={mode} ' + shlex.join(runner + ['/study/repro.test.mjs'])
                row = pilot.measure(image, volume, runtime + ' two tests ' + mode, command, deadline=25)
                receipt['results'].append(row)
                print(f"{row['label']}: exit={row['exitCode']} timeout={row['timedOut']}", flush=True)
            command = SETUP + 'node /pilot/import-fresh-repro.mjs trace-source; ' + shlex.join(runner + ['./import-fresh-suite/tests/test.js'])
            row = pilot.measure(image, volume, runtime + ' traced suite (instrumented package)', command, deadline=25)
            receipt['results'].append(row)
            print(f"{row['label']}: exit={row['exitCode']} timeout={row['timedOut']}", flush=True)
        for label, argv, deadline in cases:
            row = pilot.measure(image, volume, label, SETUP + shlex.join(argv), deadline=deadline)
            receipt['results'].append(row)
            OUTPUT.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT.write_text(json.dumps(receipt, indent=2) + '\n')
            print(f"{label}: exit={row['exitCode']} timeout={row['timedOut']}", flush=True)
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
