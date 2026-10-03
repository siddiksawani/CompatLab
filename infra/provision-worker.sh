#!/usr/bin/env bash
set -euo pipefail
if [[ "${COMPATLAB_FRESH_EXECUTION_HOST:-}" != 1 || $(id -u) != 0 || $(uname -m) != x86_64 ]]; then
  echo "Provisioning requires an explicitly selected fresh root-owned Linux amd64 execution host." >&2
  exit 1
fi
source /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 24.04 ]]; then
  echo "This recipe requires Ubuntu 24.04." >&2
  exit 1
fi
apt-get update
apt-get install --yes --no-install-recommends ca-certificates curl gnupg iproute2 iptables wireguard-tools e2fsprogs util-linux
install -d -m 0755 /etc/apt/keyrings
curl --fail --silent --show-error https://download.docker.com/linux/ubuntu/gpg --output /etc/apt/keyrings/docker.asc
fingerprint=$(gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc | awk -F: '$1=="fpr"{print $10;exit}')
test "$fingerprint" = 9DC858229FC7DD38854AE2D88D81803C0EBFCD88
chmod 0644 /etc/apt/keyrings/docker.asc
rm -f /etc/apt/sources.list.d/docker.list /etc/apt/sources.list.d/docker.sources
echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable' > /etc/apt/sources.list.d/compatlab-docker.list
apt-get update
apt-get install --yes --allow-downgrades --no-install-recommends \
  docker-ce=5:29.8.2-1~ubuntu.24.04~noble docker-ce-cli=5:29.8.2-1~ubuntu.24.04~noble \
  containerd.io=2.3.6-1~ubuntu.24.04~noble docker-buildx-plugin=0.37.1-1~ubuntu.24.04~noble \
  docker-compose-plugin=5.6.0-1~ubuntu.24.04~noble
runsc_directory=$(mktemp -d)
trap 'rm -rf "$runsc_directory"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/google/gvisor/releases/download/release-20260928.0/gvisor-x86_64.tar.bz2 \
  --output "$runsc_directory/gvisor.tar.bz2"
echo "c8d3a9fd4d4c4f5b8ff213caa4517356be128d18659ec4cde37828fe797f61a9725a602a846c81a8ed19c057a996515d31c081eba343ed4613a89951ba32ed59  $runsc_directory/gvisor.tar.bz2" | sha512sum --check
tar -xjf "$runsc_directory/gvisor.tar.bz2" -C /usr/local/bin
/usr/local/bin/runsc install -- --platform=systrap
install -d -m 0700 /var/lib/compatlab /etc/compatlab
cat > /etc/sysctl.d/90-compatlab.conf <<'SYSCTL'
net.bridge.bridge-nf-call-iptables=1
net.bridge.bridge-nf-call-ip6tables=1
SYSCTL
modprobe br_netfilter
sysctl --system
systemctl restart docker
docker version --format '{{.Server.Version}}'
runsc --version
curl --fail --silent --show-error --location --retry 3 \
  https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz \
  --output "$runsc_directory/node.tar.xz"
echo "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6  $runsc_directory/node.tar.xz" | sha256sum --check
install -d -m 0755 /opt/compatlab-node
tar -xJf "$runsc_directory/node.tar.xz" -C /opt/compatlab-node --strip-components=1
PATH=/opt/compatlab-node/bin:$PATH npm install --global --ignore-scripts pnpm@12.8.1
