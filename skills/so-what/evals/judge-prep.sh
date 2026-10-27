#!/usr/bin/env bash
# Prepare judging: blind every case and run, then render the judge prompts.
#   judge-prep.sh <run-dir>
# For each case and run writes, with absolute paths filled in,
#   <run>/judge/<case>.rN.prompt.md           from prompts/judge.md
#   <run>/judge/<case>.rN.headline.prompt.md  from prompts/headline-judge.md
# Judges write <case>.rN.tsv and <case>.rN.headline.tsv next to them.
# Prints each prompt path. Calls no model.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

[ $# -eq 1 ] && [ -d "$1" ] || { printf 'usage: %s <run-dir>\n' "${0##*/}" >&2; exit 2; }
run=$(cd "$1" && pwd)
mkdir -p "$run/judge"

# render <template>: fill every {{NAME}} from the variables named below
render() {
  local t
  t=$(cat "$1")
  for k in CASE MODE FLOOR CASES PATCH BLIND HEADLINE JUDGE_OUT; do
    eval "v=\${$k}"
    t=${t//\{\{$k\}\}/$v}
  done
  printf '%s\n' "$t"
}

for c in $(bash "$here/cells.sh" "$run" | awk -F'\t' '{ print $2 }' | sort -u); do
  bash "$here/blind.sh" "$run" "$c" >/dev/null
  CASE=$c
  MODE=$(tr -d '\r\n' <"$here/fixtures/$c/mode")
  FLOOR=$(tr -d '\r\n' <"$here/fixtures/$c/floor")
  CASES="$here/cases.md"
  PATCH="$here/fixtures/$c/change.patch"
  for key in "$run"/blind/"$c".r[0-9]*.key; do
    r=${key##*.r}; r=r${r%.key}
    base="$run/blind/$c.$r"
    BLIND="$base.md"
    HEADLINE="$base.headline.md"
    JUDGE_OUT="$run/judge/$c.$r.tsv"
    render "$here/prompts/judge.md" >"$run/judge/$c.$r.prompt.md"
    printf '%s\n' "$run/judge/$c.$r.prompt.md"
    JUDGE_OUT="$run/judge/$c.$r.headline.tsv"
    render "$here/prompts/headline-judge.md" >"$run/judge/$c.$r.headline.prompt.md"
    printf '%s\n' "$run/judge/$c.$r.headline.prompt.md"
  done
done
