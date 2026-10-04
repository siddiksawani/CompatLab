#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]]
role=${1:?Pass vps or worker}
public_key=${2:?Pass the dedicated deployment public-key file}
[[ "$role" == vps || "$role" == worker ]]
ssh-keygen -lf "$public_key" >/dev/null
[[ $(wc -l < "$public_key") -eq 1 ]]
install -d -m 700 /etc/compatlab /var/lib/compatlab-deploy
install -d -m 755 /usr/local/lib/compatlab /opt/compatlab/releases
printf '%s\n' "$role" > /etc/compatlab/deployment-role
printf '%s\n' "$role" > /usr/local/lib/compatlab/role
chmod 644 /usr/local/lib/compatlab/role
for name in release.py deploy.py deploy-request.py; do
  install -m 644 "infra/$name" "/usr/local/lib/compatlab/$name"
done
cat > /usr/local/sbin/compatlab-deploy <<'SH'
#!/bin/sh
exec /usr/bin/env -i PATH=/opt/compatlab-node/bin:/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -E -s /usr/local/lib/compatlab/deploy.py "$@"
SH
chmod 755 /usr/local/sbin/compatlab-deploy
if ! id compatlab-deploy >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/compatlab-deployer --shell /bin/sh compatlab-deploy
fi
install -d -m 700 -o compatlab-deploy -g compatlab-deploy /var/lib/compatlab-deployer/.ssh
{
  printf 'restrict,command="/usr/bin/python3 -E -s /usr/local/lib/compatlab/deploy-request.py" '
  cat "$public_key"
} > /var/lib/compatlab-deployer/.ssh/authorized_keys
chown compatlab-deploy:compatlab-deploy /var/lib/compatlab-deployer/.ssh/authorized_keys
chmod 600 /var/lib/compatlab-deployer/.ssh/authorized_keys
if [[ "$role" == vps ]]; then
  printf 'compatlab-deploy ALL=(root) NOPASSWD: /usr/local/sbin/compatlab-deploy deploy *\n' > /etc/sudoers.d/compatlab-deploy
  cat > /usr/local/sbin/compatlab-admin <<'SH'
#!/bin/sh
cd /opt/compatlab/current || exit 1
export ADMIN_DATABASE_URL_FILE=/etc/compatlab/operator-url
exec /opt/compatlab-node/bin/node apps/cli/dist/bin.js admin "$@"
SH
  chmod 755 /usr/local/sbin/compatlab-admin
else
  if [[ ! -f /etc/compatlab/host-profile ]]; then
    sha256sum infra/provision-worker.sh | cut -d' ' -f1 > /etc/compatlab/host-profile
  fi
  printf 'compatlab-deploy ALL=(root) NOPASSWD: /usr/local/sbin/compatlab-deploy stage *, /usr/local/sbin/compatlab-deploy stop *, /usr/local/sbin/compatlab-deploy activate *, /usr/local/sbin/compatlab-deploy status, /usr/local/sbin/compatlab-deploy token\n' > /etc/sudoers.d/compatlab-deploy
fi
chmod 440 /etc/sudoers.d/compatlab-deploy
visudo -cf /etc/sudoers.d/compatlab-deploy
