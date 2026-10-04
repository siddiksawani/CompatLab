#!/usr/bin/env bash
set -euo pipefail
[[ "$GITHUB_REPOSITORY" == siddiksawani/CompatLab && "$GITHUB_REF" == refs/heads/main ]]
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]
release_directory=$(mktemp -d)
registry=ghcr.io/siddiksawani
trap 'docker logout ghcr.io >/dev/null 2>&1; rm -rf "$release_directory"' EXIT
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
for component in web control proxy; do
  image="$registry/compatlab-$component:$GITHUB_SHA"
  if [[ "$component" == proxy ]]; then
    docker build --label org.opencontainers.image.source=https://github.com/siddiksawani/CompatLab --label "org.opencontainers.image.revision=$GITHUB_SHA" --file infra/Caddy.Dockerfile --tag "$image" .
  else
    docker build --label org.opencontainers.image.source=https://github.com/siddiksawani/CompatLab --label "org.opencontainers.image.revision=$GITHUB_SHA" --file infra/Dockerfile --target "$component" --tag "$image" .
  fi
  docker push "$image"
  docker inspect --format '{{index .RepoDigests 0}}' "$image" > "$release_directory/$component-image"
done
container=$(docker create "$registry/compatlab-control:$GITHUB_SHA")
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; docker logout ghcr.io >/dev/null 2>&1; rm -rf "$release_directory"' EXIT
mkdir "$release_directory/app"
docker cp "$container:/app/." "$release_directory/app/"
cp -R infra "$release_directory/app/"
tar -czf "$release_directory/app.tar.gz" -C "$release_directory/app" .
python3 infra/release.py manifest "$release_directory" "$GITHUB_SHA"
printf 'Qualified production artifacts for commit %s. Deployment runs after publication.\n' "$GITHUB_SHA" > "$release_directory/notes.txt"
if gh release view "production-$GITHUB_SHA" >/dev/null 2>&1; then
  echo 'An immutable release already exists. Refusing to replace its artifacts.' >&2
  exit 1
fi
gh release create "production-$GITHUB_SHA" "$release_directory/app.tar.gz" "$release_directory/manifest.json" \
  --target "$GITHUB_SHA" --title "Production ${GITHUB_SHA:0:12}" --notes-file "$release_directory/notes.txt" --latest=false
