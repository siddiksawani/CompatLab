#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_OS:-}" != "Linux" || "${RUNNER_ARCH:-}" != "X64" ]]; then
  echo "This installer is only for disposable Linux x64 GitHub Actions runners." >&2
  exit 1
fi

runsc_dir=$(mktemp -d)
trap 'rm -rf "$runsc_dir"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/google/gvisor/releases/download/release-20260928.0/gvisor-x86_64.tar.bz2 \
  --output "$runsc_dir/gvisor.tar.bz2"
echo "c8d3a9fd4d4c4f5b8ff213caa4517356be128d18659ec4cde37828fe797f61a9725a602a846c81a8ed19c057a996515d31c081eba343ed4613a89951ba32ed59  $runsc_dir/gvisor.tar.bz2" | sha512sum --check
sudo tar -xjf "$runsc_dir/gvisor.tar.bz2" -C /usr/local/bin
sudo /usr/local/bin/runsc install -- --platform=systrap
sudo systemctl restart docker
runsc --version
for attempt in {1..6}; do
  if timeout 5 docker info --format '{{json .Runtimes}}' | jq --exit-status 'has("runsc")' >/dev/null; then
    exit 0
  fi
  sleep 1
done
echo "Docker did not become ready with runsc after restarting." >&2
exit 1
