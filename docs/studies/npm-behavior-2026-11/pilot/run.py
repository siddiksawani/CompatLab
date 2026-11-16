import hashlib
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.request import urlopen
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
CASES = (
    ("pump", "upstream_suite", [["./node_modules/pump/test-browser.js"], ["./node_modules/pump/test-node.js"]], None),
    ("split2", "upstream_suite", [["./node_modules/split2/test.js"]], r"(?m)^# tests\s+(\d+)\s*$"),
    ("bcrypt", "named_behavior", [["/pilot/bcrypt.cjs"]], None),
    ("esbuild", "named_behavior", [["/pilot/esbuild.cjs"]], None),
    ("sharp", "named_behavior", [["/pilot/sharp.cjs"]], None),
    ("better-sqlite3", "named_behavior", [["/pilot/better-sqlite3.cjs"]], None),
    ("thread-stream", "named_behavior", [["/pilot/thread-stream.cjs"]], None),
    ("end-of-stream", "upstream_suite", [["./node_modules/end-of-stream/test.js"]], r"(?m)^# tests\s+(\d+)\s*$"),
    (
        "require-from-string", "upstream_suite", [[
            "/pilot/upstream-cli.cjs", "mocha", "--reporter", "json", "--exit",
            "./node_modules/require-from-string/test/index.js",
        ]], r'"tests":\s*(\d+)',
    ),
    (
        "bcrypt", "upstream_suite", [[
            "/pilot/upstream-cli.cjs", "jest", "--runInBand", "--json", "--config",
            '{"rootDir":"/study/bcrypt-suite"}',
        ]], r'"numTotalTests":\s*(\d+)',
    ),
    (
        "spdy", "upstream_suite", [[
            "/pilot/upstream-cli.cjs", "mocha", "--reporter", "json", "--exit",
            "./node_modules/spdy/test/client-test.js", "./node_modules/spdy/test/server-test.js",
        ]], r'"tests":\s*(\d+)',
    ),
)
STUDY_CONTROL = {
    "version": "18.2.0",
    "integrity": "sha512-9OpKOLeaoNFecEp7P6iYbzze/5CqWoH7N3SMs/6y1XF4nMvFMspEGZzJ6uFi9MmQwXhyzqYoSEKO3tvA3Z/o2w==",
    "tarball": "https://registry.npmjs.org/yargs/-/yargs-18.2.0.tgz",
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
    tested = {name for name, _, _, _ in CASES}
    pinned["yargs"] = STUDY_CONTROL
    for name in tested | {"yargs"}:
        package = lock["packages"][f"node_modules/{name}"]
        assert package["version"] == pinned[name]["version"], name
        assert package["integrity"] == pinned[name]["integrity"], name
        assert package["resolved"] == pinned[name]["tarball"], name
    for path, package in lock["packages"].items():
        if path:
            assert not package.get("link"), path
            assert re.fullmatch(r"https://registry\.npmjs\.org/[^?#\s]+\.tgz", package["resolved"]), path
            assert re.fullmatch(r"sha512-[A-Za-z0-9+/]{86}==", package["integrity"]), path
    return {name: pinned[name]["version"] for name in sorted(tested)}


def build_image(sources, versions):
    with tempfile.TemporaryDirectory(prefix="compatlab-behavior-") as temporary:
        context = Path(temporary) / "context"
        shutil.copytree(ROOT, context)
        for name, source in sources.items():
            assert name in versions and re.fullmatch(r"[a-z0-9-]+", name), name
            assert re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", source["repository"])
            assert re.fullmatch(r"[a-f0-9]{40}", source["commit"])
            for filename, digest in source["files"].items():
                path = PurePosixPath(filename)
                assert not path.is_absolute() and ".." not in path.parts, filename
                url = f"https://raw.githubusercontent.com/{source['repository']}/{source['commit']}/{filename}"
                with urlopen(url, timeout=20) as response:
                    data = response.read(256 * 1024 + 1)
                assert len(data) <= 256 * 1024 and hashlib.sha256(data).hexdigest() == digest, url
                destination = context / "source-suites" / name / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
        return cli("docker", "build", "--quiet", "--network=none", "--platform=linux/amd64", str(context), timeout=180)


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
    sources = json.loads((ROOT / "source-suites.json").read_text())
    image = build_image(sources, versions)
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
        "upstreamSuiteSources": sources,
        "preparation": [],
        "results": [],
        "diagnostics": [],
    }
    try:
        pins = measure(image, volume, "runtime versions", "node --version; bun --version; deno --version; npm --version; gcc -dumpfullversion; node24 --version")
        receipt["runtimeVersions"] = pins
        assert successful(pins)
        lines = pins["stdoutAndStderr"].splitlines()
        assert lines[0] == "v" + PROFILES["node"][0]
        assert lines[1] == PROFILES["bun"][0]
        assert lines[2].startswith("deno " + PROFILES["deno"][0] + " ")
        assert lines[-1] == "v24.21.0"
        install = measure(
            image, volume, "locked npm install",
            "npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org",
            writable_seed=True, connected=True, deadline=120,
        )
        receipt["preparation"].append(install)
        if not successful(install):
            raise RuntimeError("Locked preparation failed. See the pilot artifact.")
        prerequisites = {}
        for name, hook in (("bcrypt", "install"), ("esbuild", "postinstall"), ("better-sqlite3", "install")):
            spec = shlex.quote(f"{name}@{versions[name]}")
            prefix = "npm_config_nodedir=/usr/local npm_config_jobs=2 " if name == "better-sqlite3" else ""
            result = measure(
                image, volume, f"{name} lifecycle",
                f"{prefix}npm rebuild --offline --no-audit --no-fund --foreground-scripts {spec}",
                writable_seed=True,
                deadline=480 if name == "better-sqlite3" else 75,
            )
            receipt["preparation"].append(result)
            result["hookObserved"] = f"> {name}@{versions[name]} {hook}" in result["stdoutAndStderr"]
            prerequisites[name] = successful(result) and result["hookObserved"]
        for name, tier, arguments, count_pattern in CASES:
            if not prerequisites.get(name, True):
                receipt["results"].append({"package": name, "tier": tier, "status": "preparation_failed"})
                continue
            baseline_count = None
            setup = "cp -R /workspace/. /study/; cd /study; "
            if name in sources:
                setup += f"cp -R /pilot/source/{name}/. node_modules/{name}/; "
            if name == "end-of-stream":
                setup += "mkdir -p node_modules/end-of-stream/node_modules; ln -s ../../tape-v4 node_modules/end-of-stream/node_modules/tape; "
            if name == "bcrypt" and tier == "upstream_suite":
                setup += "cp -R node_modules/bcrypt bcrypt-suite; "
            profiles = PROFILES if name != "spdy" else {**PROFILES, "node24": ("24.21.0", ["node24"])}
            for runtime, (_, runner) in profiles.items():
                commands = [shlex.join(runner + argv) for argv in arguments]
                command = setup + "; ".join(commands)
                row = measure(image, volume, f"{name} / {runtime}", command)
                row.update(package=name, tier=tier, runtime=runtime, status="pass" if successful(row) else "replay_required")
                if count_pattern:
                    assertion_count = re.search(count_pattern, row["stdoutAndStderr"])
                    row["testCount"] = int(assertion_count[1]) if assertion_count else None
                    if not row["testCount"]:
                        row["status"] = "replay_required"
                    elif runtime == "node" and row["status"] == "pass":
                        baseline_count = row["testCount"]
                    elif baseline_count and row["status"] == "pass" and row["testCount"] != baseline_count:
                        row["status"] = "coverage_mismatch"
                receipt["results"].append(row)
                print(f"{name} {tier} {runtime}: {row['status']}", flush=True)
                if row["status"] != "pass":
                    row["replay"] = measure(image, volume, f"{name} / {runtime} replay", command)
        for order in ("fresh", "after-helper"):
            argv = PROFILES["deno"][1] + ["./yargs-diagnostic.mjs", order]
            command = "cp -R /workspace/. /study/; cp /pilot/yargs-diagnostic.mjs /study/; cd /study; " + shlex.join(argv)
            for attempt in range(1, 4):
                receipt["diagnostics"].append(measure(image, volume, f"yargs {order} {attempt}", command))
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
