#!/bin/sh
# Fetch a complete staging revision once, not one GitHub request per module.
# Only the public runtime roots are exported. Production files are untouched.
set -eu
umask 022
cache=/var/cache/professional-preview
remote=https://github.com/co-va/professional.git
mode=loop
if [ "${1:-}" = --once ]; then
  mode=once
  remote="${2:-$remote}"
fi
export GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_NOSYSTEM=1
mkdir -p "$cache/snapshots"
repo="$cache/repository.git"
if [ ! -d "$repo/objects" ]; then git init --bare -q "$repo"; fi
refresh() (
  set -eu
  timeout 45 git --git-dir="$repo" -c http.sslVerify=true -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=15 fetch --quiet --depth=1 --no-tags "$remote" '+refs/heads/staging:refs/heads/staging'
  rev="$(git --git-dir="$repo" rev-parse refs/heads/staging)"
  if [ -f "$cache/current/__preview_revision" ] && [ "$(cat "$cache/current/__preview_revision")" = "$rev" ]; then return 0; fi
  dest="$cache/snapshots/$rev"
  tmp="$(mktemp -d "$cache/snapshots/.incoming.XXXXXX")"
  archive="$tmp/runtime.tar"
  trap 'rm -rf "$tmp"' EXIT
  git --git-dir="$repo" archive --format=tar "$rev" -- app-icon.svg icon-192.png booking.html chat core css index.html invite journal manifest.webmanifest online-booking professional.js professional reset-password.html service-worker.js settings timetable ui verify-email.html > "$archive"
  mkdir "$tmp/public"
  tar -xf "$archive" -C "$tmp/public"
  rm "$archive"
  if [ -n "$(find "$tmp/public" -type l -print -quit)" ]; then echo 'Preview archive contains a symlink; refusing it' >&2; return 1; fi
  for required in index.html professional.js professional/workspace.js ui/v2/v2.css; do
    test -s "$tmp/public/$required"
  done
  printf '%s\n' "$rev" > "$tmp/public/__preview_revision"
  chmod 755 "$tmp/public"
  if [ ! -d "$dest" ]; then mv "$tmp/public" "$dest"; fi
  ln -s "snapshots/$rev" "$tmp/current"
  mv -Tf "$tmp/current" "$cache/current"
  echo "Professional staging snapshot ready: $rev"
  # Keep the current snapshot and at most one preceding snapshot. The new
  # symlink is published before removal, and failed fetches never remove it.
  previous="$(ls -1dt "$cache"/snapshots/*/ 2>/dev/null | grep -v "/$rev/$" | head -n 1 || true)"
  for old in "$cache"/snapshots/*/; do
    [ -d "$old" ] || continue
    [ "$old" = "$dest/" ] || [ "$old" = "$previous" ] || rm -rf "$old"
  done
)
if [ "$mode" = once ]; then refresh; exit $?; fi
while :; do
  if ! "$0" --once; then echo 'Professional staging refresh failed; retaining last valid snapshot' >&2; fi
  sleep 45
done
