#!/usr/bin/env bash
# Mechanical scoring of eval outputs.
#   score.sh <run-dir>      one row per arm, case and run
# Each arm is linted with the lint.sh of the skill version it used, listed in
# <run>/arms.tsv (arm<TAB>skill-dir-or-none). `none` arms, arms missing from
# the file, and skill dirs without scripts/lint.sh use the current skill's lint.
# Repo invariants (column 2 of a fixture's .so-what/invariants.tsv) are passed as
# --invariant when that lint.sh supports the flag.
# Columns: arm, case, run, core (format rules other than the map), map
# (ok = present and valid, absent = no map, invalid = map rule broken), words.
# Older skill versions used another marker name and Mermaid; both are
# normalised or excluded from `core` so versions compare on equal terms.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
current="$here/../scripts/lint.sh"

[ $# -eq 1 ] && [ -d "$1" ] || { printf 'usage: %s <run-dir>\n' "${0##*/}" >&2; exit 2; }
run=${1%/}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

lint_for() {
  local dir=""
  [ -f "$run/arms.tsv" ] && dir=$(awk -F'\t' -v a="$1" '$1 == a { print $2; exit }' "$run/arms.tsv")
  case $dir in
    ""|none) printf '%s\n' "$current" ;;
    *) if [ -f "$dir/scripts/lint.sh" ]; then printf '%s\n' "$dir/scripts/lint.sh"
       else printf 'score.sh: %s has no scripts/lint.sh for arm %s; using current lint\n' "$dir" "$1" >&2; printf '%s\n' "$current"; fi ;;
  esac
}

printf 'arm\tcase\trun\tcore\tmap\twords\n'
bash "$here/cells.sh" "$run" | while IFS=$(printf '\t') read -r arm name r out; do
  lint=$(lint_for "$arm")
  mode=$(tr -d '\r\n' <"$here/fixtures/$name/mode")
  floor=$(tr -d '\r\n' <"$here/fixtures/$name/floor")
  sed 's/impact-recap:/so-what:/' "$out" >"$work/out"
  inv=()
  inv_file="$here/fixtures/$name/base/.so-what/invariants.tsv"
  if [ -f "$inv_file" ] && grep -q -e '--invariant' "$lint"; then
    while IFS= read -r inv_name; do
      [ -n "$inv_name" ] && inv+=(--invariant "$inv_name")
    done <<EOF
$(awk -F'\t' '$0 !~ /^#/ && NF >= 2 { print $2 }' "$inv_file")
EOF
  fi
  # A PR output may lead with its title ("Title: ..." or a bare subject)
  # before the marker block; lint the title as a subject, the block as pr.
  : >"$work/title-lint"
  if [ "$mode" = pr ] && ! head -n 1 "$work/out" | grep -q '^<!-- so-what:start -->'; then
    if grep -q '^<!-- so-what:start -->' "$work/out"; then
      awk '/^<!-- so-what:start -->/ { exit } NF { sub(/^Title:[ \t]*/, ""); print; exit }' "$work/out" >"$work/title"
      awk 'f || /^<!-- so-what:start -->/ { f = 1; print }' "$work/out" >"$work/block"
      mv "$work/block" "$work/out"
      bash "$lint" subject "$work/title" >"$work/title-lint" 2>&1 || true
    fi
  fi
  bash "$lint" "$mode" "$work/out" --risk "$floor" ${inv[@]+"${inv[@]}"} >"$work/lint" 2>&1 || true
  cat "$work/title-lint" >>"$work/lint"
  core=$(grep -v -e 'impact map:' -e 'mermaid is not used' -e '^lint.sh: ' "$work/lint" | grep -c . || true)
  if grep -q 'impact map: missing' "$work/lint"; then map=absent
  elif grep -q 'impact map:' "$work/lint"; then map=invalid
  else map=ok; fi
  if [ "$core" -eq 0 ]; then core_result=pass; else core_result="fail($core)"; fi
  words=$(wc -w <"$out" | tr -d ' ')
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$arm" "$name" "$r" "$core_result" "$map" "$words"
done
