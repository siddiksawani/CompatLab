#!/usr/bin/env python3
"""Root-owned deployment entry point; invoked through a restricted SSH command."""

import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from release import RELEASES, activate, atomic_write, commit, current_main, stage, validate_manifest

CONFIG = Path("/etc/compatlab")
STATE = Path("/var/lib/compatlab-deploy")
NODE = "/opt/compatlab-node/bin/node"
CURRENT = Path("/opt/compatlab/current")


def run(args, *, cwd=None, data=None, timeout=120, env=None):
    result = subprocess.run([str(a) for a in args], cwd=cwd, input=data, capture_output=True, timeout=timeout, env=env)
    if result.returncode:
        # Output belongs to a root-readable deployment journal, never the public site.
        sys.stderr.write(result.stderr.decode(errors="replace")[-12000:])
        raise RuntimeError(f"Command failed: {args[0]} {args[1] if len(args) > 1 else ''}")
    return result.stdout


def environment(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            result[key] = value
    return result


def set_environment(path, values):
    previous = environment(path)
    previous.update(values)
    atomic_write(path, "".join(f"{k}={v}\n" for k, v in previous.items()))


def admin(directory, *arguments, migrate=False):
    env = {**os.environ, "ADMIN_DATABASE_URL_FILE": str(CONFIG / ("migration-url" if migrate else "operator-url"))}
    args = [NODE, "apps/cli/dist/bin.js", "admin", *arguments]
    if arguments[0] != "status":
        args += ["--reason", "Qualified production deployment."]
    return json.loads(run(args, cwd=directory, env=env, timeout=90))


def compose(directory, *arguments, data=None, timeout=180):
    env = {**os.environ, "COMPATLAB_CONFIG_DIR": str(CONFIG)}
    return run(["docker", "compose", "--project-name", "compatlab-prod", "--env-file", directory / "release.env", "--file", directory / "infra/compose.yaml", *arguments], env=env, data=data, timeout=timeout)


def write_release_env(directory, manifest):
    atomic_write(directory / "release.env", "COMPATLAB_BIND_ADDRESS=95.211.43.107\n" + "".join(f"COMPATLAB_{component.upper()}_IMAGE={image}\n" for component, image in manifest["images"].items()))


def worker(command, data=None, timeout=300):
    return run(["ssh", "-F", CONFIG / "ssh_config", "compatlab-worker", command], data=data, timeout=timeout)


def wait_for(description, predicate, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except (OSError, RuntimeError, ValueError, urllib.error.URLError):
            pass
        time.sleep(5)
    raise RuntimeError(f"Timed out: {description}")


def healthy_web():
    with urllib.request.urlopen("http://127.0.0.1:3000/healthz", timeout=5) as response:
        return response.status == 200


def healthy_worker(directory, worker_id):
    from datetime import datetime, timezone
    status = admin(directory, "status")
    for entry in status["workers"]:
        if entry["id"] != worker_id or entry["state"] != "healthy" or entry["recoveryRequired"] or not entry["lastSeenAt"]:
            continue
        seen = datetime.fromisoformat(entry["lastSeenAt"].replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - seen).total_seconds() < 30
    return False


def inventory_registration(directory, inventory):
    atomic_write(directory / "worker-inventory.json", json.dumps(inventory))
    env = {**os.environ, "ADMIN_DATABASE_URL_FILE": str(CONFIG / "operator-url")}
    registration = CONFIG / "worker-registration.json"
    result = json.loads(run([NODE, "infra/register-worker.mjs", directory / "worker-inventory.json", registration], cwd=directory, env=env))
    if not (CONFIG / "worker-token-delivered").exists():
        token = json.loads(registration.read_text())["token"]
        worker("token", data=token.encode())
        atomic_write(CONFIG / "worker-token-delivered", "delivered\n")
    set_environment(CONFIG / "web.env", {"PUBLIC_MATRIX_ID": result["matrixId"]})
    return result["workerId"]


def install_units(directory, role):
    units = ["compatlab-worker.service"] if role == "worker" else [
        "compatlab-stack.service", "compatlab-backup.service", "compatlab-backup.timer",
        "compatlab-backup-retry.service", "compatlab-backup-retry.timer",
        "compatlab-health.service", "compatlab-health.timer",
        "compatlab-cloudflare-check.service", "compatlab-cloudflare-check.timer",
    ]
    for name in units:
        atomic_write(Path("/etc/systemd/system") / name, (directory / "infra" / name).read_bytes(), 0o644)
    for name in ("release.py", "deploy.py", "deploy-request.py"):
        atomic_write(Path("/usr/local/lib/compatlab") / name, (directory / "infra" / name).read_bytes(), 0o644)
    run(["systemctl", "daemon-reload"])
    if role == "worker":
        run(["systemctl", "enable", "compatlab-worker.service"])
    else:
        run(["systemctl", "enable", "compatlab-stack.service"])
        run(["systemctl", "enable", "--now", *[name for name in units if name.endswith(".timer")]])


def deploy(sha, rollback=False):
    if rollback:
        if (STATE / "previous").read_text().strip() != sha:
            raise ValueError("Rollback is restricted to the previous successful release.")
    else:
        current_main(sha)
    directory, manifest = stage(sha)
    write_release_env(directory, manifest)
    previous = CURRENT.resolve() if CURRENT.exists() else None
    old_manifest = json.loads((previous / "manifest.json").read_text()) if previous else None
    worker_changed = old_manifest is None or manifest["workerRevision"] != old_manifest["workerRevision"]
    inventory = json.loads(worker(f"stage {sha}", timeout=900)) if worker_changed else None
    compose(directory, "pull", "postgres", "web", "control", "proxy", timeout=900)
    compose(directory, "up", "-d", "--wait", "postgres")
    migration_changed = old_manifest is None or manifest["migrationsDigest"] != old_manifest["migrationsDigest"]
    if previous:
        admin(previous, "deployment-begin", sha)
    switched_worker = False
    paused = previous is not None
    old_proxy = (CONFIG / "proxy.env").read_bytes()
    old_web = (CONFIG / "web.env").read_bytes()
    try:
        if previous and worker_changed:
            wait_for("existing scans to finish", lambda: not admin(previous, "status")["queue"], 900)
        if migration_changed and not rollback:
            if previous:
                run(["systemctl", "start", "compatlab-backup.service"], timeout=600)
            admin(directory, "migrate", migrate=True)
            compose(directory, "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "compatlab", data=(directory / "infra/grants.sql").read_bytes())
        if not previous:
            admin(directory, "deployment-begin", sha)
            paused = True
            admin(directory, "worker-guard-enable")
        if worker_changed:
            worker(f"stop {sha}")
            switched_worker = True
            worker_id = inventory_registration(directory, inventory)
            worker(f"activate {sha}")
            atomic_write(directory / "worker-release", sha)
        elif previous:
            for name in ("worker-inventory.json", "worker-release"):
                atomic_write(directory / name, (previous / name).read_bytes())
        ranges = json.loads((directory / "infra/cloudflare-ips.json").read_text())
        set_environment(CONFIG / "proxy.env", {"CLOUDFLARE_CIDRS": " ".join(ranges["ipv4"] + ranges["ipv6"])})
        compose(directory, "run", "--rm", "--no-deps", "proxy", "caddy", "validate", "--config", "/etc/caddy/Caddyfile")
        run(["python3", directory / "infra/origin.py", "apply", directory / "infra/cloudflare-ips.json"])
        compose(directory, "up", "-d", "--wait", "--wait-timeout", "120", "web", "control", "proxy")
        activate(directory)
        wait_for("website health", healthy_web, 120)
        if worker_changed:
            wait_for("reconciled worker heartbeat", lambda: healthy_worker(directory, worker_id), 150)
        if (CONFIG / "public-enabled").exists():
            run(["curl", "--fail", "--silent", "--show-error", "--max-time", "20", "https://compatlab.me/healthz"])
        subprocess.run(["python3", directory / "infra/origin.py", "check", directory / "infra/cloudflare-ips.json"], timeout=45, check=False)
        install_units(directory, "vps")
        admin(directory, "deployment-end", sha)
        paused = False
        if previous and previous != directory:
            atomic_write(STATE / "previous", previous.name)
        atomic_write(STATE / "last-success.json", json.dumps({"commit": sha, "completedAt": time.time()}))
        print(json.dumps({"deployed": sha, "workerUpdated": worker_changed}))
    except BaseException:
        atomic_write(STATE / "last-failure.json", json.dumps({"commit": sha, "failedAt": time.time()}))
        try:
            if previous:
                atomic_write(CONFIG / "proxy.env", old_proxy)
                atomic_write(CONFIG / "web.env", old_web)
                worker_restored = not switched_worker
                if switched_worker:
                    try:
                        worker(f"stop {sha}")
                        worker_id = inventory_registration(previous, json.loads((previous / "worker-inventory.json").read_text()))
                        worker(f"activate {(previous / 'worker-release').read_text().strip()}")
                        wait_for("previous worker heartbeat", lambda: healthy_worker(previous, worker_id), 150)
                        worker_restored = True
                    except Exception:
                        print("Worker rollback failed. Keeping admission paused.", file=sys.stderr)
                run(["python3", previous / "infra/origin.py", "apply", previous / "infra/cloudflare-ips.json"])
                compose(previous, "up", "-d", "--wait", "--wait-timeout", "120", "web", "control", "proxy")
                activate(previous)
                wait_for("previous website health", healthy_web, 120)
                if paused and worker_restored:
                    admin(directory, "deployment-end", sha)
                print("Previous release restored.", file=sys.stderr)
        except BaseException:
            print("Rollback needs operator attention. Admission remains paused.", file=sys.stderr)
        raise


def worker_action(action, sha=None):
    if action == "token":
        value = sys.stdin.buffer.read(128).decode().strip()
        if not re.fullmatch(r"clw_[A-Za-z0-9_-]{43}", value):
            raise ValueError("Invalid worker token.")
        token = CONFIG / "worker-token"
        if token.exists():
            if token.read_text().strip() != value:
                raise ValueError("Worker token already provisioned.")
        else:
            atomic_write(token, value + "\n")
        return
    if action == "status":
        print(json.dumps({"release": CURRENT.resolve().name if CURRENT.exists() else None, "freeBytes": shutil.disk_usage("/var/lib/compatlab").free, "serviceActive": subprocess.run(["systemctl", "is-active", "--quiet", "compatlab-worker"]).returncode == 0}))
        return
    sha = commit(sha)
    if action == "stage":
        directory, manifest = stage(sha)
        if (CONFIG / "host-profile").read_text().strip() != manifest["hostRevision"]:
            raise ValueError("Worker host recipe changed. Qualify the host upgrade before deploying.")
        inventory_file = directory / "worker-inventory.json"
        if not inventory_file.exists():
            with tempfile.TemporaryDirectory(prefix="inventory-", dir=STATE) as temporary:
                run([NODE, "infra/worker-images.mjs", temporary], cwd=directory, timeout=840)
                raw = json.loads((Path(temporary) / "worker-capabilities.json").read_text())
                raw["images"] = [json.loads(p.read_text()) for p in sorted(Path(temporary).glob("runtime-*.json"))]
                atomic_write(inventory_file, json.dumps(raw))
        print(inventory_file.read_text())
        return
    directory = RELEASES / sha
    validate_manifest(json.loads((directory / "manifest.json").read_text()), sha)
    if action in {"stop", "activate"}:
        if Path("/etc/systemd/system/compatlab-worker.service").exists():
            run(["systemctl", "stop", "compatlab-worker.service"])
    if action == "activate":
        if not (directory / "worker-inventory.json").is_file():
            raise ValueError("Worker images are not staged.")
        activate(directory)
        install_units(directory, "worker")
        run(["systemctl", "start", "compatlab-worker.service"])


def main():
    os.umask(0o077)
    if os.getuid() != 0:
        raise SystemExit("Root-owned deployment service only.")
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    role = (CONFIG / "deployment-role").read_text().strip()
    allowed = {"deploy", "rollback"} if role == "vps" else {"stage", "activate", "stop", "status", "token"} if role == "worker" else set()
    if action not in allowed or len(sys.argv) != (2 if action in {"status", "token"} else 3):
        raise ValueError("Unsupported deployment command.")
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open("/run/compatlab-deploy.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if role == "vps":
            sha = commit(sys.argv[2])
            try:
                deploy(sha, rollback=action == "rollback")
            except BaseException:
                atomic_write(STATE / "last-failure.json", json.dumps({"commit": sha, "failedAt": time.time()}))
                raise
        else:
            worker_action(action, sys.argv[2] if len(sys.argv) == 3 else None)


if __name__ == "__main__":
    main()
