#!/usr/bin/env python3
import os
from pathlib import Path
import re

role = Path("/usr/local/lib/compatlab/role").read_text().strip()
command = os.environ.get("SSH_ORIGINAL_COMMAND", "")
pattern = r"deploy [a-f0-9]{40}" if role == "vps" else r"(?:(?:stage|stop|activate) [a-f0-9]{40}|status|token)" if role == "worker" else r"(?!)"
if not re.fullmatch(pattern, command):
    raise SystemExit("This key only accepts a qualified CompatLab deployment command.")
os.execve("/usr/bin/sudo", ["sudo", "-n", "/usr/local/sbin/compatlab-deploy", *command.split(" ")], {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin"})
