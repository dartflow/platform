#!/usr/bin/env bash
# Read-only controle van twee DartFlow-endpoints op één origin.
set -euo pipefail

if [[ $# != 3 ]]; then
  printf 'Gebruik: %s <origin> <staging|production> <volledige-sha>\n' "$0" >&2
  exit 2
fi

origin=${1%/}
environment=$2
release_sha=$3

if [[ ! $environment =~ ^(staging|production)$ || ! $release_sha =~ ^[a-f0-9]{40}$ ]]; then
  printf 'Ongeldige omgeving of SHA.\n' >&2
  exit 2
fi
if [[ ! $origin =~ ^https://[A-Za-z0-9.-]+$ && ! $origin =~ ^http://127\.0\.0\.1:[0-9]{1,5}$ ]]; then
  printf 'Gebruik de afgesproken HTTPS-origin of een lokale loopbackpoort.\n' >&2
  exit 2
fi

for endpoint in /api/health /api/ready; do
  response=$(curl --silent --show-error --fail --max-time 10 \
    --header 'Accept: application/json' "${origin}${endpoint}")
  if ! jq -e --arg environment "$environment" --arg release "$release_sha" \
    '.status == "ok" and .environment == $environment and .release == $release' \
    <<<"$response" >/dev/null; then
    printf 'Afwijkende release- of gezondheidsstatus voor %s op %s.\n' "$endpoint" "$origin" >&2
    exit 1
  fi
  printf 'PASS %s %s %s %s\n' "$origin" "$endpoint" "$environment" "$release_sha"
done
