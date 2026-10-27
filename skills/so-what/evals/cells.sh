#!/usr/bin/env bash
# List generated outputs in a run dir, one per line:
#   cells.sh <run-dir> [case]    arm<TAB>case<TAB>rN<TAB>path-to-out.txt
# Layout is <run>/<arm>/<case>/r<N>/out.txt. The older <run>/<arm>/<case>/out.txt
# counts as r1 when no r1 exists.
set -euo pipefail

[ $# -ge 1 ] && [ -d "$1" ] || { printf 'usage: %s <run-dir> [case]\n' "${0##*/}" >&2; exit 2; }
run=${1%/}
only=${2:-}

for arm_dir in "$run"/*/; do
  arm=$(basename "$arm_dir")
  case $arm in blind|judge) continue ;; esac
  for case_dir in "$arm_dir"*/; do
    [ -d "$case_dir" ] || continue
    name=$(basename "$case_dir")
    [ -z "$only" ] || [ "$name" = "$only" ] || continue
    [ -f "${case_dir}out.txt" ] && [ ! -f "${case_dir}r1/out.txt" ] && printf '%s\t%s\tr1\t%s\n' "$arm" "$name" "${case_dir}out.txt"
    for run_dir in "$case_dir"r[0-9]*/; do
      [ -f "${run_dir}out.txt" ] || continue
      printf '%s\t%s\t%s\t%s\n' "$arm" "$name" "$(basename "$run_dir")" "${run_dir}out.txt"
    done
  done
done
exit 0
