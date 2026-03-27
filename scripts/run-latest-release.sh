#!/usr/bin/env bash

set -euo pipefail

DEFAULT_REPO="Verizane/t3code"
DEFAULT_INSTALL_ROOT="${HOME}/installs/t3code"
INSTALL_SENTINEL=".install-complete"

repo="$DEFAULT_REPO"
install_root="$DEFAULT_INSTALL_ROOT"
passthrough_args=()

usage() {
  cat <<'EOF'
Usage: scripts/run-latest-release.sh [--repo owner/repo] [--install-root <path>] [-- <t3 args...>]
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

while (($# > 0)); do
  case "$1" in
    --repo)
      if (($# < 2)); then
        printf 'Missing value for --repo\n' >&2
        exit 1
      fi
      repo="$2"
      shift 2
      ;;
    --install-root)
      if (($# < 2)); then
        printf 'Missing value for --install-root\n' >&2
        exit 1
      fi
      install_root="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      passthrough_args=("$@")
      break
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command bun
require_command curl
require_command tar
require_command python3

mkdir -p "$install_root"
install_root="$(cd "$install_root" && pwd)"

github_api="https://api.github.com/repos/${repo}/releases?per_page=20"
auth_header=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  auth_header=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

release_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'User-Agent: t3code-release-launcher' \
  "${auth_header[@]}" \
  "$github_api")"

mapfile -t release_fields < <(
  python3 -c '
import json
import sys

releases = json.load(sys.stdin)
published = [release for release in releases if not release.get("draft") and release.get("published_at")]
published.sort(key=lambda release: release["published_at"], reverse=True)

if not published:
    raise SystemExit("No published releases found.")

latest = published[0]
print(latest["tag_name"])
' <<<"$release_json"
)

if ((${#release_fields[@]} != 1)); then
  printf 'Failed to resolve latest release metadata for %s\n' "$repo" >&2
  exit 1
fi

tag_name="${release_fields[0]}"
tarball_url="https://github.com/${repo}/archive/refs/tags/${tag_name}.tar.gz"
version_dir="${install_root}/${tag_name}"

is_installed() {
  [[ -f "${version_dir}/${INSTALL_SENTINEL}" ]] &&
    [[ -f "${version_dir}/apps/server/dist/index.mjs" ]] &&
    [[ -f "${version_dir}/apps/server/dist/client/index.html" ]]
}

install_release() {
  local parent_dir temp_dir archive_path
  parent_dir="$(dirname "$version_dir")"
  temp_dir="${parent_dir}/$(basename "$version_dir").tmp-$$"
  archive_path="${parent_dir}/$(basename "$version_dir").tar.gz"

  rm -rf "$version_dir" "$temp_dir"
  rm -f "$archive_path"
  mkdir -p "$parent_dir"

  trap 'rm -rf "$temp_dir"; rm -f "$archive_path"' RETURN

  printf 'Downloading release source into %s\n' "$version_dir"
  curl -fsSL \
    -H 'Accept: application/octet-stream' \
    -H 'User-Agent: t3code-release-launcher' \
    "${auth_header[@]}" \
    -o "$archive_path" \
    "$tarball_url"

  mkdir -p "$temp_dir"
  tar -xzf "$archive_path" --strip-components=1 -C "$temp_dir"

  (
    cd "$temp_dir"
    bun install --frozen-lockfile
  )

  (
    cd "$temp_dir/apps/web"
    bun run build
  )

  (
    cd "$temp_dir"
    bun apps/server/scripts/cli.ts build
  )

  printf 'ok\n' > "${temp_dir}/${INSTALL_SENTINEL}"
  mv "$temp_dir" "$version_dir"

  rm -f "$archive_path"
  trap - RETURN
}

if is_installed; then
  printf 'Using installed release %s from %s\n' "$tag_name" "$version_dir"
else
  install_release
fi

printf 'Running %s with Bun\n' "$tag_name"
cd "$version_dir"
exec bun apps/server/dist/index.mjs "${passthrough_args[@]}"
