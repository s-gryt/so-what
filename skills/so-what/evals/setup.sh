#!/usr/bin/env bash
# Build a throwaway git repo for one eval case.
#   commit mode: base committed on main, change staged.
#   pr mode:     base committed on main, change committed on branch feature.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

usage() {
  printf 'usage: %s <case> <dest-dir>\n' "${0##*/}" >&2
  exit 2
}

[ $# -eq 2 ] || usage
case_dir="$here/fixtures/$1"
dest=$2
[ -d "$case_dir" ] || { printf 'setup.sh: no such case: %s\n' "$1" >&2; exit 2; }
[ ! -e "$dest" ] || [ -z "$(ls -A "$dest")" ] || { printf 'setup.sh: %s is not empty\n' "$dest" >&2; exit 2; }

mkdir -p "$dest"
git init -q "$dest"
git -C "$dest" symbolic-ref HEAD refs/heads/main
g() { git -C "$dest" -c user.name=eval -c user.email=eval@example.invalid -c commit.gpgsign=false "$@"; }

cp -R "$case_dir/base/." "$dest/"
g add -A
g commit -q -m base

mode=$(tr -d '\r\n' <"$case_dir/mode")
case $mode in
  commit)
    g apply --index --whitespace=nowarn "$case_dir/change.patch"
    ;;
  pr)
    g checkout -q -b feature
    g apply --index --whitespace=nowarn "$case_dir/change.patch"
    g commit -q -m wip
    ;;
  *) printf 'setup.sh: bad mode %s\n' "$mode" >&2; exit 2 ;;
esac
printf '%s\n' "$mode"
