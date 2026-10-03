#!/usr/bin/env bash
set -euo pipefail
release_directory=${1:?Pass a new release-output directory outside the checkout}
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Release builds require a clean reviewed checkout." >&2
  exit 1
fi
node --input-type=module - "$release_directory" <<'JS'
import { relative, resolve } from "node:path";
const path = relative(process.cwd(), resolve(process.argv[2]));
if (path !== ".." && !path.startsWith("../")) throw new Error("Release output must be outside the checkout.");
JS
mkdir -m 700 "$release_directory"
docker build --target web --file infra/Dockerfile --iidfile "$release_directory/web-image" .
docker build --target control --file infra/Dockerfile --iidfile "$release_directory/control-image" .
docker build --file infra/Caddy.Dockerfile --iidfile "$release_directory/proxy-image" .
{
  printf 'COMPATLAB_WEB_IMAGE=%s\n' "$(cat "$release_directory/web-image")"
  printf 'COMPATLAB_CONTROL_IMAGE=%s\n' "$(cat "$release_directory/control-image")"
  printf 'COMPATLAB_PROXY_IMAGE=%s\n' "$(cat "$release_directory/proxy-image")"
} > "$release_directory/release.env"
git rev-parse HEAD > "$release_directory/source-commit"
echo "Release image IDs recorded in $release_directory/release.env"
