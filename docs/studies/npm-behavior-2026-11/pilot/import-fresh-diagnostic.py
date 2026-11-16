"""Follow-up observations; never replace the frozen study's original receipts."""
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
               'image': image, 'runsc': pilot.cli('runsc', '--version'), 'results': []}
    try:
        receipt['versions'] = pilot.measure(image, volume, 'versions', 'node --version; deno --version')
        receipt['preparation'] = pilot.measure(image, volume, 'locked install',
            'npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org',
            writable_seed=True, connected=True, deadline=120)
        assert pilot.successful(receipt['preparation'])
        cases = [
            ('node full suite', ['node', '--test', '--test-reporter=tap', './import-fresh-suite/tests/test.js', './import-fresh-suite/tests/skip-node-modules.js'], 180),
            ('deno full suite', DENO_TEST + ['./import-fresh-suite/tests/test.js', './import-fresh-suite/tests/skip-node-modules.js'], 180),
            ('deno isolated TLA case', DENO_TEST + ['--filter=top-level await can use importFresh without deadlock', './import-fresh-suite/tests/test.js'], 30),
        ]
        for runtime, runner in [('node', ['node']), ('deno', DENO)]:
            cases += [(runtime + ' ' + mode, runner + ['/pilot/import-fresh-repro.mjs', mode], 25)
                      for mode in ('als', 'hook', 'nested')]
        for label, argv, deadline in cases:
            row = pilot.measure(image, volume, label, SETUP + shlex.join(argv), deadline=deadline)
            receipt['results'].append(row)
            OUTPUT.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT.write_text(json.dumps(receipt, indent=2) + '\n')
            print(f"{label}: exit={row['exitCode']} timeout={row['timedOut']}", flush=True)
    finally:
        receipt['completedAt'] = pilot.now()
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(receipt, indent=2) + '\n')
        pilot.cli('docker', 'volume', 'rm', volume)


if __name__ == '__main__':
    main()
