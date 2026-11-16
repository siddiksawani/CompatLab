import hashlib
import json
import os
import platform
import re
import shlex
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
OUTPUT = Path("test-results/npm-behavior-pilot.json")
PROFILES = {
    "node": ("26.10.0", ["node"]),
    "bun": ("1.4.2", ["bun", "run", "--no-install"]),
    "deno": (
        "2.9.7",
        ["deno", "run", "-A", "--no-config", "--no-lock", "--node-modules-dir=manual",
         "--cached-only"],
    ),
}
CASES = {
    "pump": ("upstream_suite", ["node_modules/pump/test-browser.js", "node_modules/pump/test-node.js"]),
    "split2": ("upstream_suite", ["node_modules/split2/test.js"]),
    "bcrypt": ("named_behavior", ["/pilot/bcrypt.cjs"]),
    "esbuild": ("named_behavior", ["/pilot/esbuild.cjs"]),
}


def cli(*args, timeout=60):
    result = subprocess.run(
        args, timeout=timeout, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
    )
    output = result.stdout.strip()
    if result.returncode:
        raise RuntimeError(f"{' '.join(args[:2])} failed: {output[-4000:]}")
    return output


def now():
    return datetime.now(timezone.utc).isoformat()


def validate_pins():
    lock = json.loads((ROOT / "package-lock.json").read_text())
    cohort = json.loads((ROOT.parent / "cohort.json").read_text())["packages"]
    pinned = {row["name"]: row for row in cohort}
    assert len(pinned) == len(cohort) == 24
    for name in CASES:
        package = lock["packages"][f"node_modules/{name}"]
        assert package["version"] == pinned[name]["version"], name
        assert package["integrity"] == pinned[name]["integrity"], name
        assert package["resolved"] == pinned[name]["tarball"], name
    for path, package in lock["packages"].items():
        if path:
            assert not package.get("link"), path
            assert re.fullmatch(r"https://registry\.npmjs\.org/[^?#\s]+\.tgz", package["resolved"]), path
            assert re.fullmatch(r"sha512-[A-Za-z0-9+/]{86}==", package["integrity"]), path
    return {name: pinned[name]["version"] for name in CASES}


def measure(image, volume, label, command, writable_seed=False, connected=False, deadline=75):
    network = "bridge" if connected else "none"
    mount = f"type=volume,src={volume},dst=/workspace"
    if not writable_seed:
        mount += ",readonly"
    cid = cli(
        "docker", "create", "--runtime=runsc", "--network", network, "--read-only",
        "--user=65534:65534", "--cap-drop=ALL", "--security-opt=no-new-privileges:true",
        "--pids-limit=128", "--cpus=2", "--memory=1536m",
        "--log-driver=local", "--log-opt=max-size=1m", "--log-opt=max-file=2",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777",
        "--tmpfs=/study:rw,exec,nosuid,nodev,size=384m,mode=1777",
        "--mount", mount, image, command,
    )
    try:
        actual = cli("docker", "inspect", "--format", "{{.HostConfig.Runtime}} {{.HostConfig.NetworkMode}}", cid)
        assert actual == f"runsc {network}", actual
        started = now()
        cli("docker", "start", cid)
        timed_out = False
        try:
            exit_code = int(cli("docker", "wait", cid, timeout=deadline))
        except subprocess.TimeoutExpired:
            timed_out = True
            cli("docker", "kill", cid)
            exit_code = int(cli("docker", "wait", cid))
        log = cli("docker", "logs", cid)
        state = json.loads(cli("docker", "inspect", "--format", "{{json .State}}", cid))
        return {
            "label": label,
            "command": command,
            "network": network,
            "startedAt": started,
            "endedAt": now(),
            "exitCode": exit_code,
            "timedOut": timed_out,
            "outOfMemory": state["OOMKilled"],
            "containerError": state["Error"],
            "stdoutAndStderr": log[-65000:],
        }
    finally:
        cli("docker", "rm", "-f", cid)


def successful(row):
    return row["exitCode"] == 0 and not (
        row["timedOut"] or row["outOfMemory"] or row["containerError"]
    )


def run():
    assert os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert platform.system() == "Linux" and platform.machine() == "x86_64"
    versions = validate_pins()
    image = cli("docker", "build", "--quiet", "--network=none", "--platform=linux/amd64", str(ROOT), timeout=180)
    assert re.fullmatch(r"sha256:[a-f0-9]{64}", image), image
    volume = cli("docker", "volume", "create", f"compatlab-behavior-{uuid4().hex}")
    receipt = {
        "schemaVersion": 1,
        "startedAt": now(),
        "sourceCommit": os.environ["GITHUB_SHA"],
        "kernel": platform.release(),
        "runtime": cli("runsc", "--version"),
        "image": image,
        "lockSha256": hashlib.sha256((ROOT / "package-lock.json").read_bytes()).hexdigest(),
        "versions": versions,
        "preparation": [],
        "results": [],
    }
    try:
        pins = measure(image, volume, "runtime versions", "node --version; bun --version; deno --version; npm --version")
        receipt["runtimeVersions"] = pins
        assert successful(pins)
        lines = pins["stdoutAndStderr"].splitlines()
        assert lines[0] == "v" + PROFILES["node"][0]
        assert lines[1] == PROFILES["bun"][0]
        assert lines[2].startswith("deno " + PROFILES["deno"][0] + " ")
        install = measure(
            image, volume, "locked npm install",
            "npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org",
            writable_seed=True, connected=True, deadline=120,
        )
        receipt["preparation"].append(install)
        if not successful(install):
            raise RuntimeError("Locked preparation failed. See the pilot artifact.")
        prerequisites = {}
        for name in ("bcrypt", "esbuild"):
            spec = shlex.quote(f"{name}@{versions[name]}")
            result = measure(
                image, volume, f"{name} lifecycle",
                f"npm rebuild --offline --no-audit --no-fund --foreground-scripts {spec}",
                writable_seed=True,
            )
            receipt["preparation"].append(result)
            prerequisites[name] = successful(result)
        for name, (tier, files) in CASES.items():
            if not prerequisites.get(name, True):
                receipt["results"].append({"package": name, "tier": tier, "status": "preparation_failed"})
                continue
            for runtime, (_, runner) in PROFILES.items():
                commands = [shlex.join(runner + [f if f.startswith("/") else f"./{f}"]) for f in files]
                command = "cp -R /workspace/. /study/; cd /study; " + "; ".join(commands)
                row = measure(image, volume, f"{name} / {runtime}", command)
                row.update(package=name, tier=tier, runtime=runtime, status="pass" if successful(row) else "replay_required")
                if name == "split2":
                    assertion_count = re.search(r"(?m)^# tests\s+(\d+)\s*$", row["stdoutAndStderr"])
                    row["testCount"] = int(assertion_count[1]) if assertion_count else None
                    if not row["testCount"]:
                        row["status"] = "replay_required"
                receipt["results"].append(row)
                print(f"{name} {runtime}: {row['status']}", flush=True)
                if row["status"] == "replay_required":
                    row["replay"] = measure(image, volume, f"{name} / {runtime} replay", command)
    except Exception as error:
        receipt["infrastructureError"] = str(error)
        raise
    finally:
        receipt["completedAt"] = now()
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(receipt, indent=2) + "\n")
        cli("docker", "volume", "rm", volume)


if __name__ == "__main__":
    run()
