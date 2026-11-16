import hashlib
import io
import tarfile
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
    ("better-sqlite3", "shipped_prebuild", [["/pilot/better-sqlite3.cjs"]], None),
    ("better-sqlite3", "renamed_compiled_binding", [["/pilot/better-sqlite3.cjs", "--renamed-binding"]], None),
    ("canvas", "named_behavior", [["/pilot/canvas.cjs"]], None),
    ("thread-stream", "named_behavior", [["/pilot/thread-stream.cjs"]], None),
    ("end-of-stream", "upstream_suite", [["./node_modules/end-of-stream/test.js"]], r"(?m)^# tests\s+(\d+)\s*$"),
    (
        "require-from-string", "upstream_suite", [[
            "/pilot/upstream-cli.cjs", "mocha", "--reporter", "/pilot/mocha-reporter.cjs", "--exit",
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
            "/pilot/upstream-cli.cjs", "mocha", "--reporter", "/pilot/mocha-reporter.cjs", "--exit",
            "./node_modules/spdy/test/client-test.js", "./node_modules/spdy/test/server-test.js",
        ]], r'"tests":\s*(\d+)',
    ),
)
REMAINING = (
    "piscina", "workerpool", "http2-wrapper", "undici", "pirates", "import-fresh",
    "cls-hooked", "async-hook-domain", "cross-spawn", "execa", "foreground-child",
    "signal-exit", "readable-stream",
)
CASES += tuple((name, "named_behavior", [["/pilot/remaining.cjs", name]], None) for name in REMAINING)
CASES += (
    ("workerpool", "reduced_worker_channel", [["/pilot/worker-channel.cjs"]], None),
    ("undici", "bare_specifier", [["/pilot/remaining.cjs", "undici-bare"]], None),
    ("workerpool", "upstream_suite", [["/pilot/upstream-cli.cjs", "mocha-v11", "--reporter", "/pilot/mocha-reporter.cjs", "--exit", "./node_modules/workerpool/test/*.js"]], r'"tests":\s*(\d+)'),
    ("import-fresh", "upstream_suite", [["./import-fresh-suite/tests/test.js"], ["./import-fresh-suite/tests/skip-node-modules.js"]], r"(?m)^# tests\s+(\d+)\s*$"),
    ("cls-hooked", "upstream_subset", [["/pilot/upstream-cli.cjs", "mocha", "--reporter", "/pilot/mocha-reporter.cjs", "--exit",
        *[f"./node_modules/cls-hooked/test/{file}" for file in (
            "async-context.test.js", "async-no-run-queue-multiple.test.js", "http-events.test.js",
            "namespaces-multiple-values.test.js", "namespaces.test.js", "net-events.test.js",
            "net-events2.test.js", "promise-context-convention.spec.js")]]], r'"tests":\s*(\d+)'),
)
CASES = tuple(
    (row["name"], "root_import", [["/pilot/root-import.cjs", row["name"]]], None)
    for row in json.loads((ROOT.parent / "cohort.json").read_text())["packages"]
) + CASES
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


def build_image(sources, assets, versions):
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
        for name, asset in assets.items():
            assert name in versions and re.fullmatch(r"[a-z0-9-]+", name), name
            assert re.fullmatch(r"[A-Za-z0-9_.-]+\.tar\.gz", asset["file"]), asset["file"]
            assert asset["url"].startswith("https://github.com/")
            assert 0 < asset["bytes"] <= 16 * 1024 * 1024
            with urlopen(asset["url"], timeout=60) as response:
                data = response.read(asset["bytes"] + 1)
            assert len(data) == asset["bytes"] and hashlib.sha256(data).hexdigest() == asset["sha256"]
            destination = context / "release-assets" / name / asset["file"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
        return cli("docker", "build", "--quiet", "--network=none", "--platform=linux/amd64", str(context), timeout=180)


def read_container_json(cid, filename, limit):
    process = subprocess.Popen(
        ["docker", "cp", f"{cid}:/results/{filename}", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    try:
        data = process.stdout.read(limit + 65537)
        if len(data) > limit + 65536:
            return None, "Evidence archive exceeds its bound"
        if process.wait(timeout=20) != 0:
            return None, None
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            entries = archive.getmembers()
            if len(entries) != 1 or not entries[0].isfile() or entries[0].size > limit:
                return None, "Invalid evidence archive"
            return json.load(archive.extractfile(entries[0])), None
    except (ValueError, tarfile.TarError, subprocess.TimeoutExpired) as error:
        return None, str(error)
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=20)


def measure(image, volume, label, command, writable_seed=False, connected=False, deadline=75):
    network = "bridge" if connected else "none"
    mount = f"type=volume,src={volume},dst=/workspace"
    if not writable_seed:
        mount += ",readonly"
    output_volume = cli("docker", "volume", "create", f"compatlab-evidence-{uuid4().hex}")
    cid = cli(
        "docker", "create", "--runtime=runsc", "--network", network, "--read-only",
        "--user=65534:65534", "--cap-drop=ALL", "--security-opt=no-new-privileges:true",
        "--pids-limit=128", "--cpus=2", "--memory=2g",
        "--log-driver=local", "--log-opt=max-size=1m", "--log-opt=max-file=2",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777",
        "--tmpfs=/study:rw,exec,nosuid,nodev,size=768m,mode=1777",
        "--mount", mount, "--mount", f"type=volume,src={output_volume},dst=/results", image, command,
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
        completion, evidence_error = read_container_json(cid, "completion.json", 4096)
        suite, suite_error = read_container_json(cid, "suite.json", 262144)
        return {
            "suiteResult": suite,
            "suiteResultError": suite_error,
            "completion": completion,
            "completionError": evidence_error,
            "logTruncated": len(log) > 65000,
            "label": label,
            "command": command,
            "network": network,
            "startedAt": started,
            "endedAt": now(),
            "exitCode": exit_code,
            "timedOut": timed_out,
            "outOfMemory": state["OOMKilled"],
            "containerError": state["Error"],
            "stdoutAndStderr": log if len(log) <= 65000 else log[:32000] + "\n[bounded log truncated]\n" + log[-32000:],
        }
    finally:
        cli("docker", "rm", "-f", cid)
        cli("docker", "volume", "rm", output_volume)


def successful(row):
    return row["exitCode"] == 0 and not (
        row["timedOut"] or row["outOfMemory"] or row["containerError"]
    )


def run():
    assert os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    assert platform.system() == "Linux" and platform.machine() == "x86_64"
    versions = validate_pins()
    sources = json.loads((ROOT / "source-suites.json").read_text())
    assets = json.loads((ROOT / "release-assets.json").read_text())
    image = build_image(sources, assets, versions)
    assert re.fullmatch(r"sha256:[a-f0-9]{64}", image), image
    volume = cli("docker", "volume", "create", f"compatlab-behavior-{uuid4().hex}")
    receipt = {
        "schemaVersion": 2,
        "startedAt": now(),
        "sourceCommit": os.environ["GITHUB_SHA"],
        "kernel": platform.release(),
        "runtime": cli("runsc", "--version"),
        "image": image,
        "runUrl": f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
        "platform": "Linux amd64 / Debian Bookworm / glibc",
        "limits": {"cpu": 2, "memoryMiB": 2048, "pids": 128, "studyTmpfsMiB": 768, "defaultDeadlineSeconds": 75},
        "lockSha256": hashlib.sha256((ROOT / "package-lock.json").read_bytes()).hexdigest(),
        "versions": versions,
        "upstreamSuiteSources": sources,
        "releaseAssets": assets,
        "preparation": [],
        "results": [],
        "diagnostics": [],
    }
    try:
        fail_fast = measure(
            image, volume, "suite shell failure propagation",
            "sh -c 'exit 23'; echo later-suite-command-ran",
        )
        receipt["shellFailFast"] = fail_fast
        if fail_fast["exitCode"] != 23 or "later-suite-command-ran" in fail_fast["stdoutAndStderr"]:
            raise RuntimeError("The pilot shell must stop a suite at its first failed command.")
        pins = measure(image, volume, "runtime versions", "node --version; bun --version; deno --version; npm --version; gcc -dumpfullversion; node24 --version; bun144 --version")
        receipt["runtimeVersions"] = pins
        assert successful(pins)
        lines = pins["stdoutAndStderr"].splitlines()
        assert lines[0] == "v" + PROFILES["node"][0]
        assert lines[1] == PROFILES["bun"][0]
        assert lines[2].startswith("deno " + PROFILES["deno"][0] + " ")
        assert lines[-2:] == ["v24.21.0", "1.4.4"]
        receipt["missingCompletionControls"] = []
        for runtime, (_, runner) in PROFILES.items():
            early_exit = measure(image, volume, f"{runtime} zero exit with fake stdout and no completion", shlex.join(runner + ["/pilot/probe-entry.cjs", "/pilot/early-exit.cjs"]))
            receipt["missingCompletionControls"].append(early_exit)
            assert successful(early_exit) and early_exit["completion"] is None
        install = measure(
            image, volume, "locked npm install",
            "npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org",
            writable_seed=True, connected=True, deadline=120,
        )
        receipt["preparation"].append(install)
        if not successful(install):
            raise RuntimeError("Locked preparation failed. See the pilot artifact.")
        prerequisites = {}
        for name, hook in (("bcrypt", "install"), ("esbuild", "postinstall"), ("better-sqlite3", "build-release"), ("canvas", "install")):
            spec = shlex.quote(f"{name}@{versions[name]}")
            command = f"npm rebuild --offline --no-audit --no-fund --foreground-scripts {spec}"
            if name == "better-sqlite3":
                command = "cd node_modules/better-sqlite3; npm run --ignore-scripts build-release -- --jobs=2 --nodedir=/usr/local"
            if name in assets:
                command = f"mkdir -p node_modules/{name}/prebuilds; cp /pilot/assets/{name}/* node_modules/{name}/prebuilds/; {command}"
            result = measure(
                image, volume, f"{name} lifecycle",
                command,
                writable_seed=True,
                deadline=480 if name == "better-sqlite3" else 75,
            )
            receipt["preparation"].append(result)
            result["hookObserved"] = f"> {name}@{versions[name]} {hook}" in result["stdoutAndStderr"]
            prerequisites[name] = successful(result) and result["hookObserved"]
        for name, tier, arguments, count_pattern in CASES:
            if tier != "shipped_prebuild" and not prerequisites.get(name, True):
                receipt["results"].append({"package": name, "tier": tier, "status": "preparation_failed"})
                continue
            baseline_count = None
            baseline_skipped = None
            setup = "cp -R /workspace/. /study/; cd /study; "
            if name in sources:
                setup += f"cp -R /pilot/source/{name}/. node_modules/{name}/; "
            if name == "end-of-stream":
                setup += "mkdir -p node_modules/end-of-stream/node_modules; ln -s ../../tape-v4 node_modules/end-of-stream/node_modules/tape; "
            if name == "bcrypt" and tier == "upstream_suite":
                setup += "cp -R node_modules/bcrypt bcrypt-suite; "
            if name == "import-fresh" and tier == "upstream_suite":
                setup += "cp -R node_modules/import-fresh import-fresh-suite; "
            if tier == "shipped_prebuild":
                setup += "rm -rf node_modules/better-sqlite3/build; test -f node_modules/better-sqlite3/prebuilds/linux-x64.node; "
            if tier == "renamed_compiled_binding":
                binding = "node_modules/better-sqlite3/build/Release"
                setup += f"cp {binding}/better_sqlite3.node {binding}/sqlite-napi.node; cmp {binding}/better_sqlite3.node {binding}/sqlite-napi.node; "
            profiles = PROFILES
            if name == "spdy":
                profiles = {**PROFILES, "node24": ("24.21.0", ["node24"])}
            if name == "better-sqlite3" or (name in REMAINING and not tier.startswith("upstream_") and tier != "root_import"):
                profiles = {**PROFILES, "bun144": ("1.4.4", ["bun144", "run", "--no-install"])}
            for runtime, (_, runner) in profiles.items():
                if name == "import-fresh" and tier == "upstream_suite":
                    if runtime == "node":
                        runner = ["node", "--test", "--test-reporter=tap"]
                    elif runtime == "deno":
                        runner = ["deno", "test", "-A", "--no-config", "--no-lock", "--node-modules-dir=manual", "--cached-only", "--no-check", "--reporter=tap"]
                named = not tier.startswith("upstream_")
                executed_arguments = [["/pilot/probe-entry.cjs", *argv] if named else argv for argv in arguments]
                commands = [shlex.join(runner + argv) for argv in executed_arguments]
                command = setup + "; ".join(commands)
                deadline = 180 if tier.startswith("upstream_") and name in ("workerpool", "import-fresh", "cls-hooked") else 75
                row = measure(image, volume, f"{name} / {runtime}", command, deadline=deadline)
                row.update(package=name, tier=tier, runtime=runtime, status="pass" if successful(row) else "replay_required")
                row["version"] = versions[name]
                row["runtimeVersion"] = profiles[runtime][0]
                row["completionRequired"] = named
                if named:
                    expected = {"schemaVersion": 1, "file": arguments[0][0], "args": arguments[0][1:], "completed": True}
                    row["completionValid"] = row["completion"] == expected and row["completionError"] is None
                    if not row["completionValid"]:
                        row["status"] = "replay_required"
                if name == "pump" and tier == "upstream_suite":
                    row["suiteCommandsReported"] = sum(marker in row["stdoutAndStderr"] for marker in ("test-browser.js passes", "test-node.js passes"))
                    if row["suiteCommandsReported"] != 2:
                        row["status"] = "replay_required"
                if count_pattern:
                    assertion_counts = re.findall(count_pattern, row["stdoutAndStderr"])
                    if name == "import-fresh" and not assertion_counts:
                        assertion_counts = re.findall(r"(?m)^1\.\.(\d+)\s*$", row["stdoutAndStderr"])
                    row["testCount"] = sum(map(int, assertion_counts)) if assertion_counts else None
                    row["suiteCommandsReported"] = len(assertion_counts)
                    log = row["stdoutAndStderr"]
                    if name == "bcrypt":
                        skipped = re.search(r'"numPendingTests":\s*(\d+)', log)
                    elif name in ("workerpool", "require-from-string", "spdy", "cls-hooked"):
                        skipped = re.search(r'"pending":\s*(\d+)', log)
                    else:
                        skipped = re.search(r"(?m)^# (?:skip|skipped)\s+(\d+)\s*$", log)
                    row["skippedCount"] = int(skipped[1]) if skipped else 0
                    if name == "import-fresh":
                        row["skippedCount"] = sum(map(int, re.findall(r"(?m)^# (?:skip|skipped)\s+(\d+)\s*$", log)))
                    if row["suiteResult"] is not None:
                        stats = row["suiteResult"]["stats"]
                        row["testCount"] = stats["tests"]
                        row["skippedCount"] = stats["pending"]
                    if name in ("workerpool", "require-from-string", "spdy", "cls-hooked") and row["suiteResult"] is None:
                        row["status"] = "replay_required"
                    if not row["testCount"] or len(assertion_counts) != len(arguments):
                        row["status"] = "replay_required"
                    elif runtime == "node" and row["status"] == "pass":
                        baseline_count = row["testCount"]
                        baseline_skipped = row["skippedCount"]
                    elif baseline_count and row["status"] == "pass" and (row["testCount"], row["skippedCount"]) != (baseline_count, baseline_skipped):
                        row["status"] = "coverage_mismatch"
                receipt["results"].append(row)
                print(f"{name} {tier} {runtime}: {row['status']}", flush=True)
                if row["status"] != "pass":
                    row["replay"] = measure(image, volume, f"{name} / {runtime} replay", command, deadline=deadline)
                    if named:
                        row["replay"]["completionValid"] = row["replay"]["completion"] == expected and row["replay"]["completionError"] is None
                OUTPUT.parent.mkdir(parents=True, exist_ok=True)
                OUTPUT.write_text(json.dumps(receipt, indent=2) + "\n")
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
