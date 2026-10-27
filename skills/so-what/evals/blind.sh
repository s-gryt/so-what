#!/usr/bin/env bash
# Shuffle every arm's output for one case and run into blind labels X1..Xn.
#   blind.sh <run-dir> <case> [rN]     all runs of the case, or one
# Older skill versions' `impact-recap:` marker is shown as `so-what:`, as in score.sh.
# Per run writes
#   <run>/blind/<case>.rN.md           outputs only, labeled
#   <run>/blind/<case>.rN.headline.md  headline view of each, same labels and order
#   <run>/blind/<case>.rN.key          label<TAB>arm (never shown to the judge)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

usage() {
  printf 'usage: %s <run-dir> <case> [rN]\n' "${0##*/}" >&2
  exit 2
}

[ $# -ge 2 ] && [ $# -le 3 ] || usage
run=${1%/}
case_name=$2
[ -d "$run" ] || usage

cells=$(bash "$here/cells.sh" "$run" "$case_name")
runs=$(printf '%s\n' "$cells" | awk -F'\t' 'NF { print $3 }' | sort -u)
[ -n "$runs" ] || { printf 'blind.sh: no outputs for %s\n' "$case_name" >&2; exit 1; }
if [ $# -eq 3 ]; then
  printf '%s\n' "$runs" | grep -qx "$3" || { printf 'blind.sh: no run %s for %s\n' "$3" "$case_name" >&2; exit 1; }
  runs=$3
fi

mkdir -p "$run/blind"
for r in $runs; do
  base="$run/blind/$case_name.$r"
  seed=$(printf '%s' "$case_name.$r" | cksum | awk '{ print $1 }')
  printf '%s\n' "$cells" | awk -F'\t' -v r="$r" 'NF && $3 == r { print $1 }' | sort | awk -v seed="$seed" '
    { arm[NR] = $0 }
    END {
      srand(seed)
      for (i = NR; i > 1; i--) { j = int(rand() * i) + 1; tmp = arm[i]; arm[i] = arm[j]; arm[j] = tmp }
      for (i = 1; i <= NR; i++) printf "X%d\t%s\n", i, arm[i]
    }' >"$base.key"

  : >"$base.md"
  : >"$base.headline.md"
  while IFS=$(printf '\t') read -r label arm; do
    out=$(printf '%s\n' "$cells" | awk -F'\t' -v a="$arm" -v r="$r" '$1 == a && $3 == r { print $4 }')
    printf '===== OUTPUT %s =====\n' "$label" >>"$base.md"
    sed 's/impact-recap:/so-what:/' "$out" >>"$base.md"
    printf '\n\n' >>"$base.md"
    printf '===== OUTPUT %s =====\n' "$label" >>"$base.headline.md"
    sed 's/impact-recap:/so-what:/' "$out" >"$base.tmp"
    bash "$here/headline.sh" "$base.tmp" >>"$base.headline.md"
    rm -f "$base.tmp"
    printf '\n' >>"$base.headline.md"
  done <"$base.key"
  printf '%s outputs shuffled for %s %s\n' "$(wc -l <"$base.key" | tr -d ' ')" "$case_name" "$r"
done
