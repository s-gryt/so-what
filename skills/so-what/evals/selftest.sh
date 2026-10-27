#!/usr/bin/env bash
# Self-checks for the eval helper scripts (no model, no repo needed).
#   selftest.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then printf 'ok   %s\n' "$1"
  else printf 'FAIL %s\n--- expected\n%s\n--- actual\n%s\n' "$1" "$2" "$3"; fails=$((fails + 1)); fi
}

# commit: wrapped Impact and Risk, Needs, indented map
cat >"$work/commit.txt" <<'X'
Gate docs-check to pull requests into main

Impact: Pushes to main and PRs into other branches no longer run
docs-check, e.g. contributors lose a safety net. Weekly runs stay.
Risk: high. A broken docs page can now reach main
unchecked.
Needs: Confirm main requires
reviews.
Why: The push trigger shadowed branches.

    PR -> main  ==> check runs
    push main   ==> no check
X
check commit "Title: Gate docs-check to pull requests into main
Impact: Pushes to main and PRs into other branches no longer run docs-check, e.g. contributors lose a safety net.
Risk: high.
Needs: Confirm main requires reviews.
Map:
    PR -> main  ==> check runs
    push main   ==> no check" "$(bash "$here/headline.sh" "$work/commit.txt")"

# PR: leading title line, Worst case, wrapped bold Decision, json fence ignored, map fence kept
cat >"$work/pr.txt" <<'X'
Narrow order totals to strings

<!-- so-what:start -->
## Impact

Services deploying separately misread `Order` totals. Reusing field 4 breaks an invariant.

Worst case: Orders are billed
at the wrong amount.
**Decision:** Agree a deploy order
before merging.

## Impact map

```text
producer(new) --f3--> consumer(old) ==> misdecode
```

<details>
<summary>Why, risk, verification</summary>

## Changes
```json
{ "before": 1 }
```
</details>
<!-- so-what:end -->
X
check pr 'Title: Narrow order totals to strings
Impact: Services deploying separately misread `Order` totals.
Worst case: Orders are billed at the wrong amount.
Decision: Agree a deploy order before merging.
Map:
```text
producer(new) --f3--> consumer(old) ==> misdecode
```' "$(bash "$here/headline.sh" "$work/pr.txt")"

# a json fence is never the map; an unlabeled fence under ## Impact map is
printf '<!-- so-what:start -->\n## Impact\n\nUsers get X. More text.\n\n## Impact map\n\n```\nA --> B\n```\n\n```json\n{ "a": 1 }\n```\n' >"$work/pr2.txt"
check fence-under-heading 'Title: (none, PR body only)
Impact: Users get X.
Map:
```
A --> B
```' "$(bash "$here/headline.sh" "$work/pr2.txt")"
printf '## Impact\n\nUsers get X.\n\n```json\n{ "a": 1 }\n```\n' >"$work/pr3.txt"
check json-not-map 'Title: (none, PR body only)
Impact: Users get X.' "$(bash "$here/headline.sh" "$work/pr3.txt")"

# indented block without an arrow or node is not a map
printf 'Subject\n\nImpact: Users get X.\n\n    just some indented prose\n    more prose\n' >"$work/ind.txt"
check indent-no-arrow 'Title: Subject
Impact: Users get X.' "$(bash "$here/headline.sh" "$work/ind.txt")"

# free-form: no worst case, no risk
printf 'Rename total field\n\nThe field is renamed. Clients break.\nSecond line of the paragraph.\n\nRisk: high\n' >"$work/free.txt"
check free-form 'Title: Rename total field
Impact: The field is renamed.' "$(bash "$here/headline.sh" "$work/free.txt")"

# prepare.sh: arms.tsv append/replace, skill copy cleanup
sk="$work/skill"
mkdir -p "$sk/scripts" "$sk/references/.omc" "$sk/evals" "$sk/.omc"
printf '# skill\n' >"$sk/SKILL.md"; printf 'x\n' >"$sk/scripts/test.sh"; printf 'x\n' >"$sk/references/.omc/s"
# lint stub that records its arguments; mentions --invariant so score.sh passes the flag
printf '#!/usr/bin/env bash\n# supports --invariant\nprintf "%%s|" "$@" >>"$LINT_LOG"\nexit 0\n' >"$sk/scripts/lint.sh"
prun="$work/prun"
bash "$here/prepare.sh" "$prun" --arm a=none --cases c9-proto-contract >/dev/null
bash "$here/prepare.sh" "$prun" --arm b="$sk" --cases c9-proto-contract >/dev/null
bash "$here/prepare.sh" "$prun" --arm b="$sk" --cases c9-proto-contract --runs 2 >/dev/null 2>&1 && echo rerun-failed-expected || true
check arms-append "a	none
b	$sk" "$(cat "$prun/arms.tsv")"
check skill-copy "SKILL.md references scripts" "$(LC_ALL=C ls "$prun/b/c9-proto-contract/r1/skill" | tr '\n' ' ' | sed 's/ $//')"
check skill-no-test "lint.sh" "$(ls "$prun/b/c9-proto-contract/r1/skill/scripts")"
check skill-no-nested-omc "" "$(find "$prun/b/c9-proto-contract/r1/skill" -name .omc)"
# score.sh passes the fixture's invariants to a lint that supports the flag
printf 'Title\n\nImpact: x.\n' >"$prun/b/c9-proto-contract/r1/out.txt"
LINT_LOG="$work/lintlog" bash "$here/score.sh" "$prun" >/dev/null
check score-invariant yes "$(grep -q -F -e '--invariant|proto field numbers are never reused|' "$work/lintlog" && echo yes || echo no)"

# layout: legacy r1, multiple runs, and sd across runs
run="$work/run"
mkdir -p "$run/a/c1-pr-trigger/r1" "$run/a/c1-pr-trigger/r2" "$run/b/c1-pr-trigger" "$run/judge" "$run/blind"
for f in a/c1-pr-trigger/r1 a/c1-pr-trigger/r2 b/c1-pr-trigger; do printf 'Subject\n\nImpact: x.\n' >"$run/$f/out.txt"; done
check cells "a	c1-pr-trigger	r1
a	c1-pr-trigger	r2
b	c1-pr-trigger	r1" "$(bash "$here/cells.sh" "$run" | awk -F'\t' -v OFS='\t' '{ print $1, $2, $3 }')"
printf 'Subject\n\n<!-- impact-recap:start -->\nImpact: x.\n' >"$run/b/c1-pr-trigger/out.txt"
bash "$here/blind.sh" "$run" c1-pr-trigger >/dev/null
check blind-normalizes "1 0" "$(grep -c 'so-what:start' "$run/blind/c1-pr-trigger.r1.md" | tr '\n' ' ')$(grep -c 'impact-recap' "$run/blind/c1-pr-trigger.r1.md")"
check blind-files "c1-pr-trigger.r1.headline.md c1-pr-trigger.r1.key c1-pr-trigger.r1.md c1-pr-trigger.r2.headline.md c1-pr-trigger.r2.key c1-pr-trigger.r2.md" "$(ls "$run/blind" | tr '\n' ' ' | sed 's/ $//')"
for r in r1 r2; do
  awk -F'\t' -v r="$r" '{ s = ($2 == "a" ? (r == "r1" ? 5 : 3) : 4); printf "%s\t%d\t%d\t%d\t%d\t%d\t4\tx\n", $1, s, s, s, s, s }' "$run/blind/c1-pr-trigger.$r.key" >"$run/judge/c1-pr-trigger.$r.tsv"
done
# arm a: run means 25 and 15, sd 7.07; arm b: one run, no sd
check sd "a 20.00 7.07 2
b 20.00 - 1" "$(bash "$here/aggregate.sh" "$run" | awk '$1 == "a" || $1 == "b" { print $1, $(NF - 2), $(NF - 1), $NF }')"

# judge validation: bad score, unknown label, missing row, CR endings
good="$run/judge/c1-pr-trigger.r1.tsv"
cp "$good" "$work/good.tsv"
try() { bash "$here/aggregate.sh" "$run" >/dev/null 2>"$work/err" && echo pass || echo fail; }
awk -F'\t' -v OFS='\t' 'NR == 1 { $3 = 7 } { print }' "$work/good.tsv" >"$good"
check bad-score fail "$(try)"
sed '1s/^X[0-9]*/X9/' "$work/good.tsv" >"$good"
check bad-label fail "$(try)"
sed '1d' "$work/good.tsv" >"$good"
check missing-row fail "$(try)"
check error-names-file "yes" "$(grep -q 'c1-pr-trigger.r1.tsv' "$work/err" && echo yes || echo no)"
awk '{ printf "%s\r\n", $0 }' "$work/good.tsv" >"$good"
check crlf-ok pass "$(try)"
cp "$work/good.tsv" "$good"

[ "$fails" -eq 0 ] && printf 'all passed\n'
exit "$fails"
