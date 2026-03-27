#!/usr/bin/env bash

set -euo pipefail

DEFAULT_REPO="Verizane/t3code"
DEFAULT_INSTALL_ROOT="${HOME}/installs/t3code"
INSTALL_SENTINEL=".install-complete"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

repo="$DEFAULT_REPO"
install_root="$DEFAULT_INSTALL_ROOT"
source_mode="false"
rebuild="false"
rebuild_local="false"
rebuild_current_source="false"
source_number=""
passthrough_args=()

usage() {
  cat <<'EOF'
Usage: scripts/run-t3code.sh [run-source|rebuild-source] [--source|--run-source] [--rebuild|--rebuild-source|--rebuild-current-source] [--number|-n <n>] [--rebuild-local] [--repo owner/repo] [--install-root <path>] [-- <t3 args...>]
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

resolve_latest_release_tag() {
  local github_api release_json
  github_api="https://api.github.com/repos/${repo}/releases?per_page=20"
  release_auth_header=()
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    release_auth_header=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  release_json="$(curl -fsSL \
    -H 'Accept: application/vnd.github+json' \
    -H 'User-Agent: t3code-release-launcher' \
    "${release_auth_header[@]}" \
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

  printf '%s\n' "${release_fields[0]}"
}

run_workspace_build() {
  local build_dir="$1"

  (
    cd "$build_dir"
    bun install --frozen-lockfile
  )

  (
    cd "$build_dir/apps/web"
    bun run build
  )

  (
    cd "$build_dir"
    bun apps/server/scripts/cli.ts build
  )
}

copy_workspace_source() {
  local source_dir="$1"
  local destination_dir="$2"

  printf 'Copying source from %s into %s\n' "$source_dir" "$destination_dir"
  mkdir -p "$destination_dir"
  tar \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=.turbo \
    --exclude='apps/*/dist' \
    --exclude='apps/*/dist-electron' \
    --exclude='packages/*/dist' \
    -C "$source_dir" \
    -cf - \
    . \
    | tar -xf - -C "$destination_dir"
}

while (($# > 0)); do
  case "$1" in
    run-source)
      source_mode="true"
      shift
      ;;
    rebuild-source)
      source_mode="true"
      rebuild_current_source="true"
      shift
      ;;
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
    --source|--run-source)
      source_mode="true"
      shift
      ;;
    --number|-n)
      if (($# < 2)); then
        printf 'Missing value for --number\n' >&2
        exit 1
      fi
      source_mode="true"
      source_number="$2"
      shift 2
      ;;
    --rebuild)
      rebuild="true"
      shift
      ;;
    --rebuild-local)
      rebuild_local="true"
      shift
      ;;
    --rebuild-current-source|--rebuild-source)
      rebuild_current_source="true"
      source_mode="true"
      shift
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

selected_rebuild_modes=0
if [[ "$rebuild" == "true" ]]; then
  ((selected_rebuild_modes += 1))
fi
if [[ "$rebuild_local" == "true" ]]; then
  ((selected_rebuild_modes += 1))
fi
if [[ "$rebuild_current_source" == "true" ]]; then
  ((selected_rebuild_modes += 1))
fi

if ((selected_rebuild_modes > 1)); then
  printf 'Cannot combine multiple rebuild modes\n' >&2
  exit 1
fi

if [[ "$source_mode" == "true" && "$rebuild_local" == "true" ]]; then
  printf 'Cannot combine source mode with --rebuild-local\n' >&2
  exit 1
fi

require_command bun
require_command tar

mkdir -p "$install_root"
install_root="$(cd "$install_root" && pwd)"

tag_name=""
tarball_url=""
release_dir=""
release_auth_header=()
version_dir=""

is_installed() {
  local candidate_dir="$1"

  [[ -f "${candidate_dir}/${INSTALL_SENTINEL}" ]] &&
    [[ -f "${candidate_dir}/apps/server/dist/index.mjs" ]] &&
    [[ -f "${candidate_dir}/apps/server/dist/client/index.html" ]]
}

install_release() {
  local parent_dir temp_dir archive_path
  parent_dir="$(dirname "$release_dir")"
  temp_dir="${parent_dir}/$(basename "$release_dir").tmp-$$"
  archive_path="${parent_dir}/$(basename "$release_dir").tar.gz"

  rm -rf "$temp_dir"
  rm -f "$archive_path"
  mkdir -p "$parent_dir"

  trap 'rm -rf "$temp_dir"; rm -f "$archive_path"' RETURN

  printf 'Downloading release source into %s\n' "$release_dir"
  curl -fsSL \
    -H 'Accept: application/octet-stream' \
    -H 'User-Agent: t3code-release-launcher' \
    "${release_auth_header[@]}" \
    -o "$archive_path" \
    "$tarball_url"

  mkdir -p "$temp_dir"
  tar -xzf "$archive_path" --strip-components=1 -C "$temp_dir"

  run_workspace_build "$temp_dir"

  printf 'ok\n' > "${temp_dir}/${INSTALL_SENTINEL}"
  rm -rf "$release_dir"
  mv "$temp_dir" "$release_dir"

  rm -f "$archive_path"
  trap - RETURN
}

rebuild_local_release() {
  local parent_dir temp_dir source_dir
  parent_dir="$(dirname "$release_dir")"
  temp_dir="${parent_dir}/$(basename "$release_dir").tmp-$$"
  source_dir="$release_dir"

  if [[ ! -d "$source_dir" ]]; then
    printf 'Missing local release source: %s\n' "$source_dir" >&2
    exit 1
  fi

  rm -rf "$temp_dir"
  mkdir -p "$parent_dir"

  trap 'rm -rf "$temp_dir"' RETURN

  copy_workspace_source "$source_dir" "$temp_dir"
  run_workspace_build "$temp_dir"

  printf 'ok\n' > "${temp_dir}/${INSTALL_SENTINEL}"
  rm -rf "$release_dir"
  mv "$temp_dir" "$release_dir"

  trap - RETURN
}

resolve_source_dir_name() {
  local source_number="${1:-}"

  if [[ -n "$source_number" ]]; then
    bun "${SCRIPT_DIR}/resolve-source-install-version.ts" --root "$WORKSPACE_ROOT" --number "$source_number"
  else
    bun "${SCRIPT_DIR}/resolve-source-install-version.ts" --root "$WORKSPACE_ROOT"
  fi
}

find_latest_source_number() {
  local source_dir_name="$1"
  local latest_number=0 candidate candidate_name suffix

  while IFS= read -r candidate; do
    candidate_name="$(basename "$candidate")"
    suffix="${candidate_name#${source_dir_name}-}"

    if [[ ! "$suffix" =~ ^[0-9]+$ ]]; then
      continue
    fi

    if (( suffix > latest_number )); then
      latest_number="$suffix"
    fi
  done < <(find "$install_root" -maxdepth 1 -mindepth 1 -type d -name "${source_dir_name}-[0-9]*")

  printf '%s\n' "$latest_number"
}

ensure_source_alias() {
  local source_dir_name="$1"
  local source_install_dir="$2"
  local source_alias_dir="${install_root}/${source_dir_name}"
  local source_install_base_name

  source_install_base_name="$(basename "$source_install_dir")"

  rm -rf "$source_alias_dir"
  ln -s "$source_install_base_name" "$source_alias_dir"
}

rebuild_source_dir() {
  local source_dir_name="$1"
  local source_install_dir="$2"
  local parent_dir temp_dir

  parent_dir="$(dirname "$source_install_dir")"
  temp_dir="${parent_dir}/$(basename "$source_install_dir").tmp-$$"

  rm -rf "$temp_dir"
  mkdir -p "$parent_dir"

  trap 'rm -rf "$temp_dir"' RETURN

  copy_workspace_source "$WORKSPACE_ROOT" "$temp_dir"
  run_workspace_build "$temp_dir"

  printf 'ok\n' > "${temp_dir}/${INSTALL_SENTINEL}"
  rm -rf "$source_install_dir"
  mv "$temp_dir" "$source_install_dir"
  ensure_source_alias "$source_dir_name" "$source_install_dir"
  version_dir="$source_install_dir"

  trap - RETURN
}

prepare_source_dir() {
  local source_dir_name source_alias_dir source_latest_number source_latest_dir source_numbered_dir

  source_dir_name="$(resolve_source_dir_name)"
  source_alias_dir="${install_root}/${source_dir_name}"
  source_latest_number="$(find_latest_source_number "$source_dir_name")"

  if [[ -d "$source_alias_dir" && ! -L "$source_alias_dir" && "$source_latest_number" == "0" ]]; then
    mv "$source_alias_dir" "${source_alias_dir}-1"
    source_latest_number="1"
  fi

  if [[ -n "$source_number" ]]; then
    source_numbered_dir="${install_root}/$(resolve_source_dir_name "$source_number")"

    if [[ "$rebuild" == "true" || "$rebuild_current_source" == "true" ]]; then
      rebuild_source_dir "$source_dir_name" "$source_numbered_dir"
    elif is_installed "$source_numbered_dir"; then
      version_dir="$source_numbered_dir"
    else
      printf 'Missing source install %s. Re-run with --rebuild.\n' "$source_numbered_dir" >&2
      exit 1
    fi

    return
  fi

  if [[ "$rebuild" == "true" || "$rebuild_current_source" == "true" ]]; then
    source_latest_dir="${install_root}/$(resolve_source_dir_name "$((source_latest_number + 1))")"
    rebuild_source_dir "$source_dir_name" "$source_latest_dir"
    return
  fi

  if [[ -L "$source_alias_dir" ]] && is_installed "$source_alias_dir"; then
    version_dir="$source_alias_dir"
    return
  fi

  if (( source_latest_number > 0 )); then
    source_latest_dir="${install_root}/$(resolve_source_dir_name "$source_latest_number")"
    ensure_source_alias "$source_dir_name" "$source_latest_dir"
    version_dir="$source_latest_dir"
    return
  fi

  if is_installed "$source_alias_dir"; then
    version_dir="$source_alias_dir"
    return
  fi

  source_latest_dir="${install_root}/$(resolve_source_dir_name 1)"
  rebuild_source_dir "$source_dir_name" "$source_latest_dir"
}

prepare_release_dir() {
  require_command curl
  require_command python3

  tag_name="$(resolve_latest_release_tag)"
  tarball_url="https://github.com/${repo}/archive/refs/tags/${tag_name}.tar.gz"
  release_dir="${install_root}/${tag_name}"
  version_dir="$release_dir"
}

if [[ "$source_mode" == "true" ]]; then
  prepare_source_dir
else
  prepare_release_dir
  if [[ "$rebuild_local" == "true" ]]; then
    rebuild_local_release
  elif [[ "$rebuild" == "true" ]]; then
    install_release
  elif is_installed "$release_dir"; then
    printf 'Using installed release %s from %s\n' "$tag_name" "$release_dir"
  else
    install_release
  fi
fi

printf 'Running %s with Bun\n' "$(basename "$version_dir")"
cd "$version_dir"
exec bun apps/server/dist/index.mjs "${passthrough_args[@]}"
