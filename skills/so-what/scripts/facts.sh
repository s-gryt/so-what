#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
awk_cmd=${AWK:-awk}   # AWK=mawk|gawk|... selects the interpreter
git rev-parse --show-toplevel >/dev/null 2>&1 || {
  printf '%s: not inside a git repository; run it from the repo root\n' "${0##*/}" >&2
  exit 2
}
areas="$here/areas.tsv"
# A repo can override the risk map: SO_WHAT_AREAS=<file>, or .so-what/areas.tsv at its root.
repo_areas=$(git rev-parse --show-toplevel 2>/dev/null)/.so-what/areas.tsv
if [ -n "${SO_WHAT_AREAS:-}" ]; then areas=$SO_WHAT_AREAS
elif [ -f "$repo_areas" ]; then areas=$repo_areas; fi

usage() {
  printf 'usage: %s [--staged] [--base <rev>] [--head <rev>] [--no-log]\n' "${0##*/}" >&2
  exit 2
}

staged=0
show_log=1
ranged=0
base=""
head=HEAD
while [ $# -gt 0 ]; do
  case $1 in
    --staged) staged=1; shift ;;
    --no-log) show_log=0; shift ;;
    --base) [ $# -ge 2 ] || usage; base=$2; ranged=1; shift 2 ;;
    --head) [ $# -ge 2 ] || usage; head=$2; ranged=1; shift 2 ;;
    *) usage ;;
  esac
done

if [ "$staged" -eq 1 ] && [ "$ranged" -eq 1 ]; then
  printf '%s: --staged cannot be combined with --base or --head\n' "${0##*/}" >&2
  usage
fi

# Optional invariants: .so-what/invariants.tsv at the repo root, or SO_WHAT_INVARIANTS=<file>.
invariants=""
repo_invariants=$(git rev-parse --show-toplevel 2>/dev/null)/.so-what/invariants.tsv
if [ -n "${SO_WHAT_INVARIANTS:-}" ]; then invariants=$SO_WHAT_INVARIANTS
elif [ -f "$repo_invariants" ]; then invariants=$repo_invariants; fi
[ -z "$invariants" ] || [ -r "$invariants" ] || { printf '%s: cannot read %s\n' "${0##*/}" "$invariants" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ "$staged" -eq 1 ]; then
  diff_args=(--cached)
  printf 'scope: staged changes on %s\n' "$(git rev-parse --abbrev-ref HEAD)"
else
  if [ -z "$base" ]; then
    if git rev-parse -q --verify origin/main >/dev/null; then base=origin/main; else base=main; fi
  fi
  merge_base=$(git merge-base "$base" "$head")
  diff_args=("$merge_base" "$head")
  printf 'scope: %s...%s (merge-base %s, head %s)\n' "$base" "$head" \
    "$(git rev-parse --short "$merge_base")" "$(git rev-parse --short "$head")"
  printf 'commits: %s\n' "$(git rev-list --count "$merge_base..$head")"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    printf 'facts.sh: uncommitted changes are not in this range; commit them first to describe them\n' >&2
  fi
  if [ "$show_log" -eq 1 ]; then git log --no-merges --format='  %h %s' "$merge_base..$head"; fi
fi

git -c core.quotepath=off diff --no-renames --name-status "${diff_args[@]}" > "$work/status"
git -c core.quotepath=off diff --no-renames --numstat "${diff_args[@]}" > "$work/numstat"

if [ ! -s "$work/numstat" ]; then
  printf 'files: 0\nrisk: none\n'
  printf 'facts.sh: no changes in scope; nothing to describe\n' >&2
  exit 1
fi

"$awk_cmd" -F'\t' -v invariants="$invariants" '
  function rank(level) { return level == "high" ? 3 : level == "medium" ? 2 : level == "low" ? 1 : 0 }
  BEGIN {
    while (invariants != "" && (getline entry < invariants) > 0) {
      if (entry ~ /^[ \t]*(#|$)/) continue
      split(entry, cols, "\t")
      inv_pattern[++inv_rules] = cols[1]; inv_name[inv_rules] = cols[2]; inv_owner[inv_rules] = cols[3] == "" ? "unowned" : cols[3]
    }
  }
  FILENAME == ARGV[1] && ($0 ~ /^[ \t]*(#|$)/) { next }
  FILENAME == ARGV[1] { pattern[++rules] = $1; area_of[rules] = $2; risk_of[rules] = $3; next }
  FILENAME == ARGV[2] { status[$2] = $1; next }
  {
    path = $3
    binary = $1 == "-"
    added = binary ? 0 : $1
    removed = binary ? 0 : $2
    for (rule = 1; rule < rules; rule++) if (path ~ pattern[rule]) break
    area = area_of[rule]
    risk = risk_of[rule]
    if (status[path] == "D" && rank(risk) < 2) risk = "medium"
    for (rule = 1; rule <= inv_rules; rule++) if (path ~ inv_pattern[rule]) touched[rule] = 1
    if (!(area in area_files)) order[++areas] = area
    area_files[area]++
    area_added[area] += added
    area_removed[area] += removed
    if (rank(risk) > rank(area_risk[area])) area_risk[area] = risk
    if (rank(risk) > rank(top)) { top = risk; top_area = area }
    total_added += added
    total_removed += removed
    line[++files] = sprintf("  %s  %-8s %-6s %s%s", status[path], area, risk, path, binary ? "  (binary)" : sprintf("  +%d -%d", added, removed))
  }
  END {
    for (rule = 1; rule <= inv_rules; rule++) if (touched[rule]) { touched_count++; if (rank(top) < 2) { top = "medium"; top_area = "invariants" } }
    printf "files: %d  +%d -%d\n", files, total_added, total_removed
    printf "risk: %s (driven by %s)\n", top, top_area
    print "areas:"
    for (level = 3; level >= 1; level--)
      for (i = 1; i <= areas; i++) {
        area = order[i]
        if (rank(area_risk[area]) == level)
          printf "  %-8s %-6s %3d files  +%d -%d\n", area, area_risk[area], area_files[area], area_added[area], area_removed[area]
      }
    if (touched_count) {
      print "invariants touched:"
      for (rule = 1; rule <= inv_rules; rule++)
        if (touched[rule] && !(inv_name[rule] in printed)) { printed[inv_name[rule]] = 1; printf "  invariant: %s (owner: %s)\n", inv_name[rule], inv_owner[rule] }
    }
    print "changes:"
    for (i = 1; i <= files; i++) print line[i]
  }
' "$areas" "$work/status" "$work/numstat"
