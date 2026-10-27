#!/usr/bin/env bash
# Prepare a run: one directory per arm, case and run, ready for generator agents.
#   prepare.sh <run-dir> --arm name=<skill-dir|none>... [--cases c1,c2] [--runs N]
# Writes <run>/arms.tsv (arm<TAB>skill-dir-or-none) and, per cell,
#   <run>/<arm>/<case>/r<N>/repo/       setup.sh repo for the case
#   <run>/<arm>/<case>/r<N>/skill/      copy of the arm's skill without evals/, .omc/ and scripts/test.sh (absent for none)
#   <run>/<arm>/<case>/r<N>/prompt.md   generate.md rendered; the agent writes out.txt next to it
# Prints one absolute prompt path per cell. Calls no model.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

usage() {
  printf 'usage: %s <run-dir> --arm name=<skill-dir|none>... [--cases c1,c2] [--runs N]\n' "${0##*/}" >&2
  exit 2
}

[ $# -ge 1 ] || usage
run=$1; shift
arms=""
cases=""
runs=1
while [ $# -gt 0 ]; do
  case $1 in
    --arm) [ $# -ge 2 ] || usage; arms="$arms$2
"; shift 2 ;;
    --cases) [ $# -ge 2 ] || usage; cases=$2; shift 2 ;;
    --runs) [ $# -ge 2 ] || usage; runs=$2; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$arms" ] || usage
case $runs in ''|*[!0-9]*|0) usage ;; esac
if [ -z "$cases" ]; then
  cases=$(for d in "$here"/fixtures/*/; do basename "$d"; done | tr '\n' ',' | sed 's/,$//')
fi

mkdir -p "$run"
run=$(cd "$run" && pwd)
touch "$run/arms.tsv"
now=$(mktemp)
trap 'rm -f "$now"' EXIT

# render <template>: fill every {{NAME}} from the variables named below
render() {
  local t
  t=$(cat "$1")
  for k in WHAT REPO STATE SKILL_DIR_NOTE SKILL_STEPS OUT; do
    eval "v=\${$k}"
    t=${t//\{\{$k\}\}/$v}
  done
  printf '%s\n' "$t"
}

printf '%s' "$arms" | while IFS= read -r spec; do
  [ -n "$spec" ] || continue
  name=${spec%%=*}
  dir=${spec#*=}
  [ "$name" != "$spec" ] && [ -n "$name" ] || usage
  case $name in blind|judge|*[!A-Za-z0-9_-]*) printf 'prepare.sh: bad arm name %s\n' "$name" >&2; exit 2 ;; esac
  if [ "$dir" != none ]; then
    [ -f "$dir/SKILL.md" ] || { printf 'prepare.sh: %s has no SKILL.md\n' "$dir" >&2; exit 2; }
    dir=$(cd "$dir" && pwd)
  fi
  printf '%s\n' "$name" >>"$now"
  # replace this arm's row, keep the others
  { awk -F'\t' -v a="$name" '$1 != a' "$run/arms.tsv"; printf '%s\t%s\n' "$name" "$dir"; } >"$run/arms.tsv.new"
  mv "$run/arms.tsv.new" "$run/arms.tsv"
done

while IFS=$(printf '\t') read -r name dir; do
  for c in $(printf '%s' "$cases" | tr ',' ' '); do
    [ -d "$here/fixtures/$c" ] || { printf 'prepare.sh: no such case: %s\n' "$c" >&2; exit 2; }
    mode=$(tr -d '\r\n' <"$here/fixtures/$c/mode")
    n=1
    while [ "$n" -le "$runs" ]; do
      cell="$run/$name/$c/r$n"
      mkdir -p "$cell"
      bash "$here/setup.sh" "$c" "$cell/repo" >/dev/null
      REPO="$cell/repo"
      OUT="$cell/out.txt"
      case $mode in
        commit) WHAT="commit message"; STATE="the change is staged on branch main (git diff --staged)"; scope="--staged" ;;
        *) WHAT="pull request description"; STATE="branch feature is one commit ahead of main (git diff main...feature)"; scope="--base main --head feature" ;;
      esac
      if [ "$dir" = none ]; then
        SKILL_DIR_NOTE=""
        SKILL_STEPS="- Read the change with git diff. Do not read the git log or any original commit message."
      else
        mkdir -p "$cell/skill"
        for e in "$dir"/* "$dir"/.[!.]*; do
          [ -e "$e" ] || continue
          case $(basename "$e") in evals|.omc) continue ;; esac
          cp -R "$e" "$cell/skill/"
        done
        find "$cell/skill" -name .omc -prune -exec rm -rf {} +
        rm -f "$cell/skill/scripts/test.sh"
        SKILL_DIR_NOTE=" and the skill copy in $cell/skill"
        SKILL_STEPS="- First read $cell/skill/SKILL.md and follow it exactly to write the text. Gather the facts by running, from inside $REPO, \`bash $cell/skill/scripts/facts.sh $scope --no-log\`. Do not read the git log or any original commit message."
      fi
      render "$here/prompts/generate.md" >"$cell/prompt.md"
      printf '%s\n' "$cell/prompt.md"
      n=$((n + 1))
    done
  done
done <<EOF
$(awk -F'\t' 'FILENAME == ARGV[1] { want[$1] = 1; next } $1 in want' "$now" "$run/arms.tsv")
EOF
