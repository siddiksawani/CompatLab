"""Investigate retained assertions in disposable, offline gVisor containers."""
import hashlib
import json
import os
import platform
import shlex
from pathlib import Path
from uuid import uuid4

import run as pilot

OUTPUT = Path('test-results/import-fresh-assertions.json')
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
        for runtime in ('node', 'deno', 'deno298'):
            runner = [runtime] if runtime == 'node' else [runtime, 'run', '-A', '--no-config', '--no-lock', '--node-modules-dir=manual', '--cached-only']
            for script, args in [('builtin-sync-repro.mjs', [])] + [('import-attributes-repro.mjs', [mode]) for mode in ('direct', 'hook', 'package')]:
                label = f'{runtime} {script} {" ".join(args)}'.strip()
                row = pilot.measure(image, volume, label, SETUP + shlex.join([*runner, '/pilot/' + script, *args]), deadline=30)
                receipt['results'].append(row)
                assert not any(row[key] for key in ('timedOut', 'outOfMemory', 'containerError', 'logTruncated', 'suiteResultError'))
                assert row['suiteResult'] is not None
                print(label, json.dumps(row['suiteResult']), flush=True)
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
