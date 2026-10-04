#!/usr/bin/env python3
"""Qualify preparation and replay under the production worker's systemd policy."""

import json
import os
from pathlib import Path
import platform
import subprocess
import uuid


def run(*args, timeout=60):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout


def quoted(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def main():
    if os.geteuid() != 0 or platform.system() != "Linux" or platform.machine() != "x86_64":
        raise SystemExit("Worker service qualification requires root on Linux amd64 with systemd and runsc.")
    if subprocess.run(["systemctl", "is-active", "--quiet", "compatlab-worker"], check=False).returncode == 0:
        raise SystemExit("The production worker is active. Use an idle qualification host or drain and stop it first.")
    root = Path(__file__).resolve().parent.parent
    if "\n" in str(root) or "\r" in str(root):
        raise ValueError("The checkout path must not contain a newline.")
    unit = f"compatlab-worker-qualification-{uuid.uuid4().hex[:12]}.service"
    unit_path = Path("/run/systemd/system") / unit
    overrides = Path(str(unit_path) + ".d")
    result_path = root / "test-results/worker-service.json"
    result_path.parent.mkdir(exist_ok=True)
    result_path.unlink(missing_ok=True)
    try:
        unit_path.write_bytes((root / "infra/compatlab-worker.service").read_bytes())
        overrides.mkdir()
        (overrides / "qualification.conf").write_text(
            "[Unit]\nAfter=\nRequires=\nAfter=docker.service\nRequires=docker.service\n"
            "[Service]\nType=oneshot\nRestart=no\nTimeoutStartSec=900\nEnvironmentFile=\n"
            f"WorkingDirectory={str(root).replace('%', '%%')}\nExecStart=\n"
            f"ExecStart=/opt/compatlab-node/bin/node {quoted(root / 'scripts/rebuild-qualification.mjs')}\n"
        )
        run("systemctl", "daemon-reload")
        try:
            run("systemctl", "start", unit, timeout=930)
        finally:
            journal = run("journalctl", "--unit", unit, "--output=cat", "--no-pager")
            print(journal, end="")
        records = [json.loads(line) for line in journal.splitlines() if line.startswith('{"qualified":')]
        if len(records) != 1 or records[0].get("qualified") is not True:
            raise RuntimeError("The worker service did not publish successful rebuild evidence.")
        result_path.write_text(json.dumps({**records[0], "productionServicePolicy": True}, indent=2) + "\n")
        result_path.chmod(0o644)
    finally:
        subprocess.run(["systemctl", "stop", unit], check=False, capture_output=True, timeout=90)
        (overrides / "qualification.conf").unlink(missing_ok=True)
        if overrides.exists():
            overrides.rmdir()
        unit_path.unlink(missing_ok=True)
        run("systemctl", "daemon-reload")
        subprocess.run(["systemctl", "reset-failed", unit], check=False, capture_output=True, timeout=30)


if __name__ == "__main__":
    main()
