#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]]
public_key=${1:?Pass the dedicated backup public-key file}
ssh-keygen -lf "$public_key" >/dev/null
[[ $(wc -l < "$public_key") -eq 1 ]]
if ! id compatlab-backup >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/compatlab-backup --shell /bin/sh compatlab-backup
fi
install -d -m 700 -o compatlab-backup -g compatlab-backup /srv/compatlab-backups /var/lib/compatlab-backup/.ssh
install -d -m 755 /usr/local/lib/compatlab
install -m 644 infra/backup-receiver.py /usr/local/lib/compatlab/backup-receiver.py
{
  printf 'restrict,command="/usr/bin/timeout 3600 /usr/bin/python3 -E -s /usr/local/lib/compatlab/backup-receiver.py" '
  cat "$public_key"
} > /var/lib/compatlab-backup/.ssh/authorized_keys
chown compatlab-backup:compatlab-backup /var/lib/compatlab-backup/.ssh/authorized_keys
chmod 600 /var/lib/compatlab-backup/.ssh/authorized_keys
