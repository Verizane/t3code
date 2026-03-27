#!/bin/bash

set -u
set -o pipefail

die() {
  echo "Error: $*" >&2
  exit 1
}

run_cmd() {
  echo
  echo "+ $*"
  "$@"
}

confirm() {
  local prompt="$1"
  local default="${2:-}"
  local suffix
  local reply

  case "$default" in
    y | Y)
      suffix="[Y/n]"
      ;;
    n | N)
      suffix="[y/N]"
      ;;
    *)
      suffix="[y/n]"
      ;;
  esac

  while true; do
    read -r -p "$prompt $suffix " reply

    if [[ -z "$reply" ]]; then
      reply="$default"
    fi

    case "$reply" in
      y | Y | yes | YES)
        return 0
        ;;
      n | N | no | NO)
        return 1
        ;;
      *)
        echo "Please answer y or n."
        ;;
    esac
  done
}

rebase_in_progress() {
  local git_dir

  git_dir=$(git rev-parse --git-dir 2>/dev/null) || return 1

  [[ -d "$git_dir/rebase-merge" || -d "$git_dir/rebase-apply" ]]
}

has_unmerged_files() {
  [[ -n "$(git diff --name-only --diff-filter=U)" ]]
}

has_uncommitted_changes() {
  [[ -n "$(git status --porcelain)" ]]
}

wait_for_rebase_resolution() {
  local label="$1"
  local choice

  while true; do
    if ! rebase_in_progress && ! has_unmerged_files; then
      echo
      echo "$label completed successfully."
      return 0
    fi

    echo
    echo "$label has conflicts or an unfinished rebase."
    echo

    git status --short --branch

    if has_unmerged_files; then
      echo
      echo "Unmerged files:"
      git diff --name-only --diff-filter=U
    fi

    echo
    echo "Resolve the conflicts, then choose:"
    echo "  c = continue rebase"
    echo "  s = show full git status"
    echo "  a = abort the rebase and stop this script"

    read -r -p "> " choice

    case "$choice" in
      "" | c | C | continue)
        if has_unmerged_files; then
          echo
          echo "There are still unresolved conflicts."
          continue
        fi

        if rebase_in_progress; then
          if git rebase --continue; then
            echo
            echo "git rebase --continue succeeded. Rechecking..."
          else
            echo
            echo "git rebase --continue did not complete successfully."
            echo "Resolve the remaining issue(s) and try again."
            echo "If needed, you can also run git rebase --skip manually."
          fi
        else
          echo
          echo "No rebase is in progress anymore. Rechecking..."
        fi
        ;;
      s | S | status)
        echo
        git status
        ;;
      a | A | abort)
        echo
        if rebase_in_progress; then
          git rebase --abort || {
            echo "git rebase --abort failed."
            return 1
          }
        fi
        echo "Rebase aborted. Stopping script."
        return 1
        ;;
      *)
        echo "Unknown option: $choice"
        ;;
    esac
  done
}

run_rebase_step() {
  local label="$1"
  shift

  echo
  echo "+ $*"
  "$@"
  local rc=$?

  if [[ $rc -eq 0 ]]; then
    wait_for_rebase_resolution "$label"
    return $?
  fi

  if rebase_in_progress || has_unmerged_files; then
    wait_for_rebase_resolution "$label"
    return $?
  fi

  echo
  echo "$label failed before entering conflict resolution."
  return $rc
}

review_github_changes() {
  local compare_base="$1"
  local review_start_head
  local choice

  if [[ -z "$(git diff --name-only "$compare_base..HEAD" -- .github)" ]]; then
    echo
    echo "No .github changes detected after step 1."
    return 0
  fi

  review_start_head=$(git rev-parse HEAD) || return 1

  while true; do
    echo
    echo ".github changes detected since the start of step 1:"
    git diff --name-status "$compare_base..HEAD" -- .github

    echo
    echo "Review these files now."
    echo "Delete any unnecessary .github files."
    echo "If you make changes, create a new commit before continuing."
    echo

    read -r -p \
      "Press Enter when done, type 'status' to inspect, or 'abort' to stop: " \
      choice

    case "$choice" in
      "")
        ;;
      status | s | S)
        echo
        git status --short --branch
        continue
        ;;
      abort | a | A)
        echo "Script aborted."
        return 1
        ;;
      *)
        echo "Unknown option: $choice"
        continue
        ;;
    esac

    # Always re-check after the user confirms they are done.
    if [[ "$(git rev-parse HEAD)" != "$review_start_head" ]]; then
      echo
      echo "A new commit was detected. Continuing to step 2."
      return 0
    fi

    if has_uncommitted_changes; then
      echo
      echo "No new commit was detected, but there are uncommitted changes:"
      git status --short

      if confirm "Do you want to commit these files now?" "y"; then
        echo
        echo "Please commit your changes now."
        read -r -p "Press Enter after committing to re-check. " _
      else
        echo
        echo "Returning to the .github cleanup step."
      fi

      continue
    fi

    if confirm "No new commit was detected. Do you really want to continue?" "n"; then
      return 0
    fi

    if confirm "Do you want to abort?" "n"; then
      echo "Script aborted."
      return 1
    fi

    echo
    echo "Returning to the .github cleanup step."
  done
}

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || \
  die "This is not a git repository."

echo "== Step 1 =="

run_cmd git checkout main || die "git checkout main failed."

step1_base_head=$(git rev-parse HEAD) || die "Could not read HEAD for main."

run_cmd git fetch origin || die "git fetch origin failed."

run_rebase_step "Step 1 rebase (git rebase origin/main)" \
  git rebase origin/main || exit 1

review_github_changes "$step1_base_head" || exit 1

echo
echo "== Step 2 =="

run_cmd git push fork main --force-with-lease || \
  die "git push fork main --force-with-lease failed."

run_cmd git checkout main-fork || die "git checkout main-fork failed."

run_rebase_step "Step 2 rebase (git rebase main)" \
  git rebase main || exit 1

echo
echo "== Step 3 =="

run_cmd git push fork main-fork --force-with-lease || \
  die "git push fork main-fork --force-with-lease failed."

echo
echo "Done."