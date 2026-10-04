#!/usr/bin/env python3
"""Receive encrypted archives over a restricted backup-only SSH key."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time

DIRECTORY = Path("/srv/compatlab-backups")
NAME = r"compatlab-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[a-f0-9-]{36}\.clb"
MAX_BYTES = 20 * 1024**3
FLOOR_BYTES = 40 * 1024**3


def parse(command):
    match = re.fullmatch(rf"receive ({NAME}) ([a-f0-9]{{64}}) ([1-9][0-9]{{0,10}})", command)
    if not match or not 32 <= int(match[3]) <= MAX_BYTES:
        raise ValueError("Only a bounded encrypted backup upload is accepted.")
    return match[1], match[2], int(match[3])


def receive(directory, name, digest, size, stream):
    directory = Path(directory)
    archives = [p for p in directory.iterdir() if re.fullmatch(NAME, p.name) and p.is_file() and not p.is_symlink()]
    for path in archives:
        if path.stat().st_mtime < time.time() - 7 * 86400:
            path.unlink()
    used = sum(p.stat().st_size for p in archives if p.exists())
    destination = directory / name
    if destination.exists():
        with destination.open("rb") as existing:
            if hashlib.file_digest(existing, "sha256").hexdigest() != digest or destination.stat().st_size != size:
                raise ValueError("An archive with this name already has different contents.")
        # Consume and verify the retry as well, without replacing the original archive.
    if (not destination.exists() and used + size > MAX_BYTES) or shutil.disk_usage(directory).free < size + FLOOR_BYTES:
        raise ValueError("Backup destination storage limit reached.")
    descriptor, temporary = tempfile.mkstemp(prefix=".receiving-", dir=directory)
    try:
        count = 0
        checksum = hashlib.sha256()
        with os.fdopen(descriptor, "wb") as output:
            first = True
            while chunk := stream.read(min(1024**2, size + 1 - count)):
                if first and chunk[:4] != b"CLB1":
                    raise ValueError("Expected an encrypted CompatLab archive.")
                first = False
                count += len(chunk)
                if count > size:
                    raise ValueError("Archive exceeds declared size.")
                output.write(chunk)
                checksum.update(chunk)
            output.flush()
            os.fsync(output.fileno())
        if count != size or checksum.hexdigest() != digest:
            raise ValueError("Truncated archive or checksum mismatch.")
        os.replace(temporary, destination)
        directory_fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {"file": name, "digest": digest, "bytes": size}


if __name__ == "__main__":
    os.umask(0o077)
    name, digest, size = parse(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    with (DIRECTORY / ".upload.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(receive(DIRECTORY, name, digest, size, sys.stdin.buffer)))
