#!/usr/bin/env python3
"""Small host-side health checks with deduplicated operational email."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time
import urllib.request

from deploy import CONFIG, CURRENT, STATE, admin, environment, healthy_web, worker
from release import atomic_write


def read_state(name, fallback):
    path = STATE / name
    return json.loads(path.read_text()) if path.exists() else fallback


def problems():
    issues = []
    try:
        if not healthy_web():
            issues.append("Website health check is failing.")
    except Exception:
        issues.append("Website health check is failing.")
    try:
        status = admin(CURRENT, "status")
        matrix = environment(CONFIG / "web.env")["PUBLIC_MATRIX_ID"]
        guard = next((entry for entry in status["workerAvailability"] if entry["matrixId"] == matrix), None)
        if not guard or not guard["enabled"] or guard["paused"]:
            issues.append("The execution worker is unavailable or its admission guard is closed.")
        if any(entry["oldestSeconds"] > 900 for entry in status["queue"]):
            issues.append("A scan has been waiting or running for more than 15 minutes.")
        backup = status["health"]["lastBackupAt"]
        if not backup or (datetime.now(timezone.utc) - datetime.fromisoformat(backup.replace("Z", "+00:00"))).total_seconds() > 25 * 3600:
            issues.append("No verified off-host backup captured within the last 25 hours.")
        if status["health"]["infrastructureFailures24h"] >= 3:
            issues.append("At least three scans have failed because of infrastructure in the last 24 hours.")
    except Exception:
        issues.append("Catalog health could not be read.")
    if shutil.disk_usage("/var/lib/docker").free < 15 * 1024**3:
        issues.append("The VPS has less than 15 GiB free disk space.")
    try:
        remote = json.loads(worker("status", timeout=20))
        if remote["freeBytes"] < 8 * 1024**3:
            issues.append("The worker VM has less than 8 GiB free disk space.")
    except Exception:
        issues.append("The dedicated worker VM cannot be reached over WireGuard.")
    failure = read_state("last-failure.json", {}).get("failedAt", 0)
    success = read_state("last-success.json", {}).get("completedAt", 0)
    if failure > success:
        issues.append("The latest production deployment failed; inspect its deployment log.")
    cloudflare = read_state("cloudflare-check.json", {})
    if cloudflare.get("failed") or time.time() - cloudflare.get("checkedAt", 0) > 8 * 86400:
        issues.append("The weekly Cloudflare network check failed or is overdue.")
    elif cloudflare.get("changed"):
        issues.append("Cloudflare published different networks. Review cloudflare-candidate.json and update the allowlist through a PR.")
    return sorted(issues)


def send(subject, body, identity):
    key = (CONFIG / "resend-api-key").read_text().strip()
    if not key.startswith("re_"):
        raise ValueError("Resend sending key is missing.")
    payload = {"from": "CompatLab operations <ops@alerts.compatlab.me>", "to": ["siddikhacker@gmail.com"], "subject": subject, "text": body}
    request = urllib.request.Request("https://api.resend.com/emails", data=json.dumps(payload).encode(), headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "CompatLab-operations", "Idempotency-Key": identity}, method="POST")
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.loads(response.read(4096))
    if not result.get("id"):
        raise RuntimeError("Resend did not accept the operational alert.")
    return result["id"]


def main():
    state_file = STATE / "health.json"
    previous = read_state("health.json", {"issues": [], "sentAt": 0})
    current = problems()
    test = sys.argv[1:] == ["test"]
    changed = current != previous["issues"]
    reminder = bool(current) and time.time() - previous["sentAt"] > 86400
    if test or changed or reminder:
        subject = "CompatLab: alert test" if test else "CompatLab: attention required" if current else "CompatLab: service recovered"
        body = "\n".join(current) if current else "Website, worker, backup, disk and deployment checks are healthy."
        body += "\n\nOperator access: ssh vps\nStatus: sudo compatlab-admin status\nLogs: sudo journalctl -u compatlab-health -u compatlab-backup --since today\nWebsite: https://compatlab.me\n"
        identity = "compatlab-" + hashlib.sha256(json.dumps([subject, current, previous["sentAt"]]).encode()).hexdigest()
        receipt = send(subject, body, identity)
        atomic_write(state_file, json.dumps({"issues": current, "sentAt": time.time(), "receipt": receipt}))
        print(json.dumps({"emailAccepted": True, "issues": current, "receipt": receipt}))
    else:
        print(json.dumps({"issues": current, "emailSent": False}))


if __name__ == "__main__":
    main()
