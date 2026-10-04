#!/usr/bin/env python3
"""Immutable release manifests and bounded artifact installation."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import tempfile
import urllib.request

REPOSITORY = "siddiksawani/CompatLab"
RELEASES = Path("/opt/compatlab/releases")
MAX_ARCHIVE = 1024**3
MAX_EXPANDED = 3 * 1024**3


def commit(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ValueError("Expected a full commit SHA.")
    return value


def digest_file(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def source_digest(paths):
    digest = hashlib.sha256()
    files = []
    for path in paths:
        path = Path(path)
        files.extend([path] if path.is_file() else path.rglob("*"))
    for path in sorted(set(files)):
        if not path.is_file() or any(p in {"node_modules", "dist", "__pycache__"} for p in path.parts):
            continue
        digest.update(str(path).encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def validate_manifest(value, sha):
    commit(sha)
    if value.get("schemaVersion") != 1 or value.get("commit") != sha or value.get("repository") != REPOSITORY:
        raise ValueError("Release identity does not match.")
    for key in ("archiveDigest", "workerRevision", "migrationsDigest", "hostRevision"):
        if not re.fullmatch(r"[a-f0-9]{64}", str(value.get(key, ""))):
            raise ValueError("Invalid release digest.")
    if type(value.get("archiveBytes")) is not int or not 0 < value["archiveBytes"] <= MAX_ARCHIVE:
        raise ValueError("Invalid artifact size.")
    for component in ("web", "control", "proxy"):
        image = value.get("images", {}).get(component, "")
        if not re.fullmatch(rf"ghcr\.io/siddiksawani/compatlab-{component}@sha256:[a-f0-9]{{64}}", image):
            raise ValueError("Unexpected image registry, name or digest.")
    return value


def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "CompatLab-deploy"}), timeout=30)


def get_json(url):
    with request(url) as response:
        body = response.read(65537)
    if len(body) > 65536:
        raise ValueError("Manifest response exceeds its bound.")
    return json.loads(body)


def current_main(sha):
    result = get_json(f"https://api.github.com/repos/{REPOSITORY}/git/ref/heads/main")
    if result.get("object", {}).get("sha") != commit(sha):
        raise ValueError("Only the current qualified main commit may deploy.")


def atomic_write(path, value, mode=0o600):
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}-", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb") as output:
            output.write(value.encode() if isinstance(value, str) else value)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def activate(directory):
    link = directory.parent.parent / "current"
    temporary = link.with_name(".current-new")
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(directory)
    os.replace(temporary, link)


def extract(archive, directory):
    with tarfile.open(archive, "r:gz") as source:
        members = []
        expanded = 0
        for member in source:
            members.append(member)
            expanded += member.size
            if len(members) > 150000 or expanded > MAX_EXPANDED:
                raise ValueError("Expanded artifact exceeds its bound.")
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                raise ValueError("Release contains a special file.")
            tarfile.data_filter(member, directory)
        source.extractall(directory, members=members, filter="data")


def stage(sha, releases=RELEASES):
    sha = commit(sha)
    releases.mkdir(parents=True, exist_ok=True)
    destination = releases / sha
    if destination.exists():
        return destination, validate_manifest(json.loads((destination / "manifest.json").read_text()), sha)
    if shutil.disk_usage(releases).free < 8 * 1024**3:
        raise RuntimeError("At least 8 GiB free storage is required to stage a release.")
    url = f"https://github.com/{REPOSITORY}/releases/download/production-{sha}"
    manifest = validate_manifest(get_json(f"{url}/manifest.json"), sha)
    with tempfile.TemporaryDirectory(prefix=".stage-", dir=releases) as temporary:
        temporary = Path(temporary)
        archive = temporary / "app.tar.gz"
        with request(f"{url}/app.tar.gz") as source, archive.open("xb") as output:
            size = 0
            while chunk := source.read(1024**2):
                size += len(chunk)
                if size > manifest["archiveBytes"]:
                    raise ValueError("Artifact exceeds the declared size.")
                output.write(chunk)
        if size != manifest["archiveBytes"] or digest_file(archive) != manifest["archiveDigest"]:
            raise ValueError("Artifact checksum does not match.")
        app = temporary / "app"
        app.mkdir()
        extract(archive, app)
        for required in ("apps/cli/dist/bin.js", "infra/compose.yaml", "infra/deploy.py", "services/worker/dist/remote/bin.js"):
            if not (app / required).is_file():
                raise ValueError("Incomplete release bundle.")
        atomic_write(app / "manifest.json", json.dumps(manifest))
        os.replace(app, destination)
    return destination, manifest


def manifest(directory, sha):
    directory = Path(directory)
    archive = directory / "app.tar.gz"
    value = {
        "schemaVersion": 1,
        "repository": REPOSITORY,
        "commit": commit(sha),
        "archiveDigest": digest_file(archive),
        "archiveBytes": archive.stat().st_size,
        "workerRevision": source_digest(["pnpm-lock.yaml", "packages/contracts", "packages/engine", "services/worker", "infra/provision-worker.sh", "infra/worker-images.mjs", "infra/compatlab-worker.service"]),
        "migrationsDigest": source_digest(["packages/catalog/migrations", "infra/grants.sql"]),
        "hostRevision": digest_file("infra/provision-worker.sh"),
        "images": {component: (directory / f"{component}-image").read_text().strip() for component in ("web", "control", "proxy")},
    }
    validate_manifest(value, sha)
    atomic_write(directory / "manifest.json", json.dumps(value, indent=2) + "\n", 0o644)


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "manifest":
        raise SystemExit("Usage: release.py manifest ARTIFACT_DIRECTORY COMMIT")
    manifest(sys.argv[2], sys.argv[3])
