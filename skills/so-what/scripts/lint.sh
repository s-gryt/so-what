#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
awk_cmd=${AWK:-awk}   # AWK=mawk|gawk|... selects the interpreter

usage() {
  printf 'usage: %s subject|commit|pr|plan <file> [--risk none|low|medium|high] [--invariant "<name>"]...\n' "${0##*/}" >&2
  exit 2
}

[ $# -ge 2 ] || usage
kind=$1
file=$2
shift 2
case $kind in subject|commit|pr|plan) ;; *) usage ;; esac

floor=""
invariants=""
while [ $# -gt 0 ]; do
  case $1 in
    --risk) [ $# -ge 2 ] || usage; floor=$2; shift 2 ;;
    --invariant) [ $# -ge 2 ] || usage; invariants=${invariants:+$invariants$'\n'}$2; shift 2 ;;
    *) usage ;;
  esac
done
case $floor in ""|none) floor="" ;; low|medium|high) ;; *) usage ;; esac

[ -r "$file" ] || { printf 'lint.sh: cannot read %s\n' "$file" >&2; exit 2; }

if SO_WHAT_LINT_INVARIANTS=$invariants LC_ALL=C "$awk_cmd" -v kind="$kind" -v floor="$floor" -f "$here/lint.awk" "$file"; then
  status=0
else
  status=1
fi

# Optional: parse a mermaid impact map with mmdc when it is installed.
if [ "$kind" = pr ] && command -v mmdc >/dev/null 2>&1; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  tr -d '\r' <"$file" | "$awk_cmd" '/^[ \t]*```mermaid/ { on = 1; next } on && /^[ \t]*```/ { exit } on' >"$work/map.mmd"
  if [ -s "$work/map.mmd" ]; then
    run_mmdc=(mmdc -q -i "$work/map.mmd" -o "$work/map.svg")
    if command -v timeout >/dev/null 2>&1; then run_mmdc=(timeout 20 "${run_mmdc[@]}"); fi
    code=0
    "${run_mmdc[@]}" >"$work/mmdc.out" 2>&1 || code=$?
    if [ "$code" -eq 124 ] || { [ "$code" -ne 0 ] && grep -qiE 'launch|puppeteer|browser|chrom' "$work/mmdc.out"; }; then
      printf 'lint.sh: mmdc could not run here (timeout or no browser); mermaid parse check skipped\n' >&2
    elif [ "$code" -ne 0 ]; then
      printf '%s: impact map: mmdc could not parse the mermaid diagram\n' "$file"
      sed 's/^/    /' "$work/mmdc.out"
      status=1
    fi
  fi
fi

[ "$status" -eq 0 ] || exit 1
printf 'lint.sh: %s ok\n' "$kind"
