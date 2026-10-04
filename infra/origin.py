#!/usr/bin/env python3
"""Cloudflare policy checks and service-scoped Docker origin filtering."""

import ipaddress
import json
from pathlib import Path
import subprocess
import sys
import time

from release import atomic_write, get_json

MODE = Path("/etc/compatlab/origin-mode")
STATE = Path("/var/lib/compatlab-deploy")


def validate(value):
    for key, version, minimum in (("ipv4", 4, 12), ("ipv6", 6, 28)):
        entries = value.get(key)
        if not isinstance(entries, list) or not 1 <= len(entries) <= 100 or len(set(entries)) != len(entries):
            raise ValueError("Cloudflare ranges must be bounded, nonempty and unique.")
        for entry in entries:
            network = ipaddress.ip_network(entry, strict=True)
            if network.version != version or not network.is_global or network.prefixlen < minimum:
                raise ValueError("Cloudflare range is private, misclassified or too broad.")
    return value


def command(args, data=None, check=True):
    return subprocess.run(args, input=data, capture_output=True, check=check, timeout=30)


def apply(value, mode):
    validate(value)
    if mode not in {"bootstrap", "cloudflare"}:
        raise ValueError("Set origin-mode to bootstrap or cloudflare explicitly.")
    chain = "CLB-ORIGIN"
    # Commit the chain contents together. Other applications' chains are untouched.
    lines = ["*filter", f":{chain} - [0:0]", f"-F {chain}"]
    if mode == "cloudflare":
        lines += [f"-A {chain} -s {cidr} -j RETURN" for cidr in value["ipv4"]]
        lines += [f"-A {chain} -j DROP"]
    else:
        lines += [f"-A {chain} -j RETURN"]
    lines += ["COMMIT", ""]
    command(["iptables-restore", "--wait", "10", "--noflush"], "\n".join(lines).encode())
    route = json.loads(command(["ip", "-j", "route", "get", "1.1.1.1"]).stdout)[0]
    interface = route["dev"]
    for port in ("80", "443"):
        rule = ["-i", interface, "-p", "tcp", "-m", "conntrack", "--ctorigdst", "95.211.43.107", "--ctorigdstport", port, "-j", chain]
        if command(["iptables", "-w", "10", "-C", "DOCKER-USER", *rule], check=False).returncode:
            command(["iptables", "-w", "10", "-I", "DOCKER-USER", "1", *rule])
    # Compose binds the origin only to its IPv4 address; no IPv6 listener is created.


def check(path):
    baseline = validate(json.loads(path.read_text()))
    try:
        response = get_json("https://api.cloudflare.com/client/v4/ips")
        if response.get("success") is not True:
            raise ValueError("Cloudflare did not return a successful response.")
        result = response["result"]
        candidate = validate({"ipv4": result["ipv4_cidrs"], "ipv6": result["ipv6_cidrs"]})
        changed = any(set(candidate[k]) != set(baseline[k]) for k in ("ipv4", "ipv6"))
        atomic_write(STATE / "cloudflare-candidate.json", json.dumps(candidate, indent=2) + "\n")
        state = {"checkedAt": time.time(), "changed": changed, "failed": False}
    except Exception:
        state = {"checkedAt": time.time(), "changed": False, "failed": True}
        raise
    finally:
        atomic_write(STATE / "cloudflare-check.json", json.dumps(state))
    print(json.dumps(state))


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in {"apply", "check"}:
        raise SystemExit("Usage: origin.py apply|check RANGES_JSON")
    path = Path(sys.argv[2])
    if sys.argv[1] == "apply":
        apply(json.loads(path.read_text()), MODE.read_text().strip())
    else:
        check(path)
