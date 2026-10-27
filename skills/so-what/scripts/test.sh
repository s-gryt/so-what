#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
passed=0
failed=0

expect() {
  local want=$1 name=$2
  shift 2
  if "$@" >"$work/out" 2>&1; then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    printf 'FAIL %s: expected %s, got %s\n' "$name" "$want" "$got"
    sed 's/^/    /' "$work/out"
  fi
}

cat >"$work/commit-good" <<'EOF'
ci(guardrails): run docs checks only on pull requests to main

Impact: Contributors get one docs-guardrails run per pull request;
direct pushes to branches start none.
Needs: Confirm the draft-PR check starts before merging.
Why: Pushes to feature branches ran the full docs gate twice, once on
push and once on the pull request, doubling CI minutes.
Risk: high - a misconfigured trigger would let unchecked docs merge;
verified by opening a draft PR and seeing the check run.
Rollback: revert

    [Contributor] --> [push to feature branch] --> (no docs run)
    [Contributor] --> [open PR into main]      --> (one docs run)
EOF

cat >"$work/commit-narration" <<'EOF'
ci: update workflow

Impact: Updated docs-guardrails.yml to remove the push trigger line.
EOF

cat >"$work/commit-no-why" <<'EOF'
feat(agents): teach agents to describe impact in commits

Impact: Agents now explain who notices a change and how it was verified.
EOF

cat >"$work/commit-low-risk" <<'EOF'
docs: fix broken link to validation guide

Impact: Readers following the docs index reach the validation page.
EOF

cat >"$work/commit-underrated" <<'EOF'
ci: drop weekly schedule from docs checks

Impact: Docs checks stop running on Mondays; pull requests still run them.
Why: The weekly run duplicated pull request checks with no new signal.
Risk: low - schedule only.
EOF

cat >"$work/commit-why-first" <<'EOF2'
fix(docs): restore the validation guide link

Why: The docs index pointed at a renamed page.
Impact: Readers following the docs index reach the validation page.
EOF2

printf 'Fix: The bug.\n' >"$work/subject-bad"
printf 'feat(skills): add so-what for commit and PR descriptions\n' >"$work/subject-good"

cat >"$work/pr-good" <<'EOF'
<!-- so-what:start -->
## Impact

Agents writing commits or pull requests in this repo now lead with the
consequence of a change: who notices, what behaves differently, and how it
was verified. Reviewers can judge risk without reconstructing it from the diff.

Worst case: reviewers merge guidance that hides a real risk.
Decision: none beyond normal review.

## Impact map

```text
[Agent] --> [collect facts] --> [risk floor]
                                    |
                                    v
[Reviewer] <-- [impact-first text] -+
```

<details>
<summary>Why, risk, verification</summary>

## Why

Descriptions restated the diff, so reviewers re-derived intent and risk.

## Risk: medium

| Area | Risk | What changes in behavior |
| ---- | ---- | ------------------------ |
| Agent instructions | medium | Agents follow the new description shape |

Only agent instructions change; no gate or CI behavior moves.

## Verification

- scripts/test.sh passes

</details>
<!-- so-what:end -->
EOF

sed 's/^## Risk: medium$/## Risk: low/' "$work/pr-good" >"$work/pr-underrated"
sed 's/^```text$/```mermaid/' "$work/pr-good" >"$work/pr-mermaid-ascii-body"
grep -v 'so-what:end' "$work/pr-good" >"$work/pr-unterminated"
awk '/^## Verification/ { skip = 1 } /^<\/details>/ { skip = 0 } !skip' "$work/pr-good" >"$work/pr-no-verification"
cat >"$work/pr-diff-dump" <<'EOF'
<!-- so-what:start -->
## Impact

Changed SKILL.md and lint.sh and facts.sh and areas.tsv and upsert-pr.sh and test.sh in the skill folder.

## Why

Needed.

## Risk: medium

Low.

## Verification

None yet.
<!-- so-what:end -->
EOF

expect pass commit-good "$here/lint.sh" commit "$work/commit-good" --risk high
expect fail commit-narration "$here/lint.sh" commit "$work/commit-narration"
expect fail commit-missing-why-at-medium "$here/lint.sh" commit "$work/commit-no-why" --risk medium
expect pass commit-low-needs-impact-only "$here/lint.sh" commit "$work/commit-low-risk" --risk low
expect fail commit-risk-below-facts "$here/lint.sh" commit "$work/commit-underrated" --risk high
expect fail commit-why-before-impact "$here/lint.sh" commit "$work/commit-why-first"
expect fail subject-not-conventional "$here/lint.sh" subject "$work/subject-bad"
expect pass subject-conventional "$here/lint.sh" subject "$work/subject-good"
awk -v filler="$(printf 'Reviewers notice one more consequence here. %.0s' $(seq 1 60))" '
  /^## Why/ { print filler; print "" } { print }
' "$work/pr-good" >"$work/pr-too-long"

expect pass pr-good "$here/lint.sh" pr "$work/pr-good" --risk medium
expect fail pr-over-word-limit "$here/lint.sh" pr "$work/pr-too-long" --risk medium
expect fail pr-risk-below-facts "$here/lint.sh" pr "$work/pr-underrated" --risk medium
expect fail pr-mermaid-with-ascii-body "$here/lint.sh" pr "$work/pr-mermaid-ascii-body"
expect fail pr-unterminated "$here/lint.sh" pr "$work/pr-unterminated"
expect fail pr-no-verification "$here/lint.sh" pr "$work/pr-no-verification"
expect fail pr-diff-dump "$here/lint.sh" pr "$work/pr-diff-dump"

# impact map rules
map_commit() {
  printf 'ci(trigger): run docs checks only on pull requests\n\nImpact: Contributors get one docs run per pull request, not two.\nNeeds: Confirm the draft-PR check starts.\nWhy: Pushes ran the gate twice.\nRisk: high - trigger change; verified with a draft PR.\nRollback: revert\n\n' >"$work/$1"
  cat >>"$work/$1"
}
map_commit commit-map-ok <<'EOF'
    [Contributor] --> [open PR into main] --> (one docs run)
    [Contributor] --> [push branch]       --> (no docs run)
EOF
map_commit commit-map-box-ok <<'EOF'
    +-------------+      +------------------+
    | Contributor | ---> | one docs run     |
    +-------------+      +------------------+
EOF
map_commit commit-map-unicode <<'EOF'
    [Contributor] ──▶ [open PR into main] ──▶ (one docs run)
    [Contributor] ──▶ [push branch]       ──▶ (no docs run)
EOF
map_commit commit-map-misaligned <<'EOF'
    +-------------+      +------------------+
    | Contributor | ---> | one docs run      |
    +-------------+      +------------------+
EOF
map_commit commit-map-no-arrow <<'EOF'
    [Contributor] [open PR into main] (one docs run)
    [Contributor] [push branch]       (no docs run)
EOF
map_commit commit-map-one-node <<'EOF'
    docs run happens once per pull request now
    --> contributors wait less
    --> reviewers see fewer duplicate checks
EOF
map_commit commit-map-too-wide <<'EOF'
    [Contributor] --> [open a pull request into the main branch of the repository] --> (one docs run)
    [Contributor] --> [push]
    [Contributor] --> [x]
EOF
map_commit commit-map-file-name <<'EOF'
    [Contributor] --> [docs-guardrails.yml] --> (one docs run)
    [Contributor] --> [push branch]         --> (no docs run)
EOF
map_commit commit-map-tab <<'EOF'
    [Contributor] --> [open PR]	--> (one docs run)
    [Contributor] --> [push branch] --> (no docs run)
EOF
map_commit commit-map-too-short <<'EOF'
    [Contributor] --> (one docs run)
EOF
expect pass commit-map-ok "$here/lint.sh" commit "$work/commit-map-ok" --risk high
expect pass commit-map-box-ok "$here/lint.sh" commit "$work/commit-map-box-ok" --risk high
expect fail commit-map-unicode "$here/lint.sh" commit "$work/commit-map-unicode" --risk high
expect fail commit-map-misaligned "$here/lint.sh" commit "$work/commit-map-misaligned" --risk high
expect fail commit-map-no-arrow "$here/lint.sh" commit "$work/commit-map-no-arrow" --risk high
expect fail commit-map-one-node "$here/lint.sh" commit "$work/commit-map-one-node" --risk high
expect fail commit-map-too-wide "$here/lint.sh" commit "$work/commit-map-too-wide" --risk high
expect fail commit-map-file-name "$here/lint.sh" commit "$work/commit-map-file-name" --risk high
expect fail commit-map-tab "$here/lint.sh" commit "$work/commit-map-tab" --risk high
expect fail commit-map-too-short "$here/lint.sh" commit "$work/commit-map-too-short" --risk high
grep -v '^    ' "$work/commit-map-ok" >"$work/commit-map-missing"
expect fail commit-map-required-at-high "$here/lint.sh" commit "$work/commit-map-missing" --risk high
expect pass commit-map-optional-at-low "$here/lint.sh" commit "$work/commit-low-risk" --risk low
{ cat "$work/commit-map-ok"; printf '\n    [Extra] --> [second map] --> (nope)\n'; } >"$work/commit-map-two"
expect fail commit-map-only-one "$here/lint.sh" commit "$work/commit-map-two" --risk high
awk '/^## Impact map/ { skip = 1 } /^<details>/ { skip = 0 } !skip' "$work/pr-good" >"$work/pr-no-map"
expect fail pr-map-required-at-medium "$here/lint.sh" pr "$work/pr-no-map" --risk medium
expect pass pr-map-optional-at-low "$here/lint.sh" pr "$work/pr-no-map" --risk low
sed 's/^\[Agent\] --> \[collect facts\] --> \[risk floor\]$/[Agent] --> [collect facts] --> [risk floor/' "$work/pr-good" >"$work/pr-map-unbalanced"
expect fail pr-map-unbalanced-bracket "$here/lint.sh" pr "$work/pr-map-unbalanced" --risk medium
awk '
  /^## Impact map/ { mode = "map" } /^<details>/ { mode = "" }
  mode == "map" { map = map $0 "\n"; next }
  /^## Verification/ { printf "%s", map }
  { print }
' "$work/pr-good" >"$work/pr-map-misplaced"
expect fail pr-map-must-follow-impact "$here/lint.sh" pr "$work/pr-map-misplaced" --risk medium

# brevity limits
long_sentence=$(printf 'word %.0s' $(seq 1 35))
printf 'docs(guide): restore the validation guide link\n\nImpact: Readers following the index reach the page. %s\n' "$long_sentence" >"$work/commit-impact-too-long"
printf 'docs(guide): restore the validation guide link\n\nImpact: %s.\n' "$long_sentence" >"$work/commit-lead-too-long"
expect fail commit-impact-over-45-words "$here/lint.sh" commit "$work/commit-impact-too-long"
expect fail commit-lead-sentence-over-30-words "$here/lint.sh" commit "$work/commit-lead-too-long"
awk -v filler="$(printf 'Reviewers notice one more consequence here. %.0s' $(seq 1 10))" '
  /^## Impact$/ { print; getline; print; print filler; next } { print }
' "$work/pr-good" >"$work/pr-impact-too-long"
expect fail pr-impact-over-70-words "$here/lint.sh" pr "$work/pr-impact-too-long" --risk medium

printf 'Hand-written intro.\n\n' >"$work/body-plain"
"$here/upsert-pr.sh" --merge "$work/body-plain" "$work/pr-good" >"$work/merged-once"
{ cat "$work/merged-once"; printf '\nSummary by CodeRabbit\n'; } >"$work/body-with-tail"
sed 's/Only agent instructions change/Agent instructions change/' "$work/pr-good" >"$work/pr-revised"
"$here/upsert-pr.sh" --merge "$work/body-with-tail" "$work/pr-revised" >"$work/merged-twice"

expect pass upsert-keeps-intro grep -qx 'Hand-written intro.' "$work/merged-once"
expect pass upsert-appends-block grep -qx '<!-- so-what:end -->' "$work/merged-once"
expect pass upsert-replaces-block grep -q '^Agent instructions change' "$work/merged-twice"
expect fail upsert-drops-old-block grep -q '^Only agent instructions change' "$work/merged-twice"
expect pass upsert-keeps-tail grep -qx 'Summary by CodeRabbit' "$work/merged-twice"
expect pass upsert-single-block test "$(grep -c 'so-what:start' "$work/merged-twice")" -eq 1

repo="$work/repo"
git init -q "$repo"
git_in_repo() { git -C "$repo" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false "$@"; }
facts_in_repo() { (cd "$repo" && "$here/facts.sh" "$@"); }
git_in_repo commit -q --allow-empty -m base
mkdir -p "$repo/.github/workflows"
printf 'on: pull_request\n' >"$repo/.github/workflows/check.yml"
git_in_repo add .github
git_in_repo commit -q -m ci

facts_in_repo --base HEAD~1 --head HEAD >"$work/facts" 2>/dev/null
expect pass facts-rates-ci-high grep -q '^risk: high (driven by ci)' "$work/facts"
expect fail facts-empty-scope facts_in_repo --base HEAD --head HEAD
printf 'draft\n' >"$repo/notes.md"
git_in_repo add notes.md
facts_in_repo --staged >"$work/facts-staged" 2>/dev/null
expect pass facts-staged-rates-docs-low grep -q '^risk: low (driven by docs)' "$work/facts-staged"

cat >"$work/commit-risk-before-why" <<'EOF2'
fix(docs): restore the validation guide link

Impact: Readers following the docs index reach the validation page.
Risk: low - one link target.
Why: The docs index pointed at a renamed page.
EOF2
expect fail commit-why-after-risk "$here/lint.sh" commit "$work/commit-risk-before-why"
expect fail facts-staged-with-range "$here/facts.sh" --staged --base HEAD

grep -v '^| Agent instructions' "$work/pr-good" >"$work/pr-no-risk-row"
awk '/^\| Area/ { next } { print } /^\| Agent instructions/ { print }' "$work/pr-good" >"$work/pr-no-risk-header"
sed 's/^| Agent instructions.*$/| unspecified |/' "$work/pr-good" >"$work/pr-one-cell-risk-row"
sed 's/^| Agent instructions.*$/|   | medium | Agents follow the new description shape |/' "$work/pr-good" >"$work/pr-empty-risk-area"
sed 's/^| Agent instructions.*$/| Agent instructions |   | Agents follow the new description shape |/' "$work/pr-good" >"$work/pr-empty-risk-level"
sed 's/^| Agent instructions.*$/| Agent instructions | medium |   |/' "$work/pr-good" >"$work/pr-empty-risk-consequence"
sed 's/^- scripts\/test.sh passes$/scripts\/test.sh passes/' "$work/pr-good" >"$work/pr-no-verification-item"
expect fail pr-risk-without-area-row "$here/lint.sh" pr "$work/pr-no-risk-row"
expect fail pr-risk-without-header "$here/lint.sh" pr "$work/pr-no-risk-header"
expect fail pr-one-cell-risk-row "$here/lint.sh" pr "$work/pr-one-cell-risk-row"
expect fail pr-empty-risk-area "$here/lint.sh" pr "$work/pr-empty-risk-area"
expect fail pr-empty-risk-level "$here/lint.sh" pr "$work/pr-empty-risk-level"
expect fail pr-empty-risk-consequence "$here/lint.sh" pr "$work/pr-empty-risk-consequence"
expect fail pr-verification-without-item "$here/lint.sh" pr "$work/pr-no-verification-item"

write_commit() {
  printf 'docs(guide): restore the validation guide link\n\nImpact: %s\n' "$2" >"$work/$1"
}
write_commit commit-editors 'Editors of the docs index reach the validation page again.'
write_commit commit-replaced 'Replaced the trigger so contributors get one check per PR.'
write_commit commit-node 'Contributors on Node.js 20 run the docs gate without errors.'
write_commit commit-requirements 'Contributors installing requirements.txt get the pinned linter.'
printf 'docs(guide): restore the validation guide link\n\nImpact: Readers following the index reach\nNote: the validation page again after the rename.\n' >"$work/commit-note-continuation"

expect pass commit-noun-opener-is-not-edit-verb "$here/lint.sh" commit "$work/commit-editors"
expect fail commit-replaced-opener "$here/lint.sh" commit "$work/commit-replaced"
expect pass commit-framework-name-is-not-file "$here/lint.sh" commit "$work/commit-node"
expect fail commit-txt-file-named "$here/lint.sh" commit "$work/commit-requirements"
expect pass commit-colon-continuation "$here/lint.sh" commit "$work/commit-note-continuation"

awk '
  /^## Why/ { mode = "why" } /^## Risk/ { mode = "risk" } /^## Verification/ { mode = "" }
  mode == "why" { why = why $0 "\n"; next }
  mode == "risk" { risk = risk $0 "\n"; next }
  /^## Verification/ { printf "%s%s", risk, why }
  { print }
' "$work/pr-good" >"$work/pr-out-of-order"
awk '/^## Verification/ { print "## Before / after"; print ""; print "```markdown"; print "## Not a section"; print "```"; print "" } { print }' "$work/pr-good" >"$work/pr-heading-in-code"
expect fail pr-sections-out-of-order "$here/lint.sh" pr "$work/pr-out-of-order"
expect pass pr-heading-inside-code-fence "$here/lint.sh" pr "$work/pr-heading-in-code" --risk medium

printf 'intro\r\n<!-- so-what:start -->\r\nOLD\r\n<!-- so-what:end -->\r\nfooter\r\n' >"$work/body-crlf"
"$here/upsert-pr.sh" --merge "$work/body-crlf" "$work/pr-good" >"$work/merged-crlf"
expect fail upsert-crlf-drops-old-block grep -qx 'OLD' "$work/merged-crlf"
expect pass upsert-crlf-single-block test "$(grep -c 'so-what:start' "$work/merged-crlf")" -eq 1
expect pass upsert-crlf-keeps-footer grep -qx 'footer' "$work/merged-crlf"

printf 'a\n<!-- so-what:start -->\nuser text\n' >"$work/body-unclosed"
printf '<!-- so-what:end -->\ny\n<!-- so-what:start -->\nz\n' >"$work/body-reversed"
{ cat "$work/merged-once"; cat "$work/pr-good"; } >"$work/body-two-blocks"
expect fail upsert-refuses-unclosed "$here/upsert-pr.sh" --merge "$work/body-unclosed" "$work/pr-good"
expect fail upsert-refuses-reversed "$here/upsert-pr.sh" --merge "$work/body-reversed" "$work/pr-good"
expect fail upsert-refuses-two-blocks "$here/upsert-pr.sh" --merge "$work/body-two-blocks" "$work/pr-good"
expect fail upsert-refuses-missing-block "$here/upsert-pr.sh" --merge "$work/body-plain" "$work/missing"

mapped="$work/mapped"
git init -q "$mapped"
git -C "$mapped" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit -q --allow-empty -m base
area_of() {
  mkdir -p "$mapped/$(dirname "$1")"
  printf 'x\n' >"$mapped/$1"
  git -C "$mapped" add -A
  git -C "$mapped" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit -q -m "$1"
  (cd "$mapped" && "$here/facts.sh" --base HEAD~1 --head HEAD --no-log 2>/dev/null) | awk '/^changes:/ { on = 1; next } on { print $2 " " $3; exit }'
}
expect pass areas-ci-high test "$(area_of .github/workflows/ci.yml)" = 'ci high'
expect pass areas-migration-high test "$(area_of db/migrations/001_init.sql)" = 'data high'
expect pass areas-manifest-medium test "$(area_of package.json)" = 'deps medium'
expect pass areas-tests-low test "$(area_of src/foo.test.ts)" = 'tests low'
expect pass areas-docs-low test "$(area_of README.md)" = 'docs low'
expect pass areas-source-fallback test "$(area_of src/app.ts)" = 'source medium'


# decision line
grep -v '^Decision:' "$work/pr-good" >"$work/pr-no-decision"
sed 's/^## Risk: medium$/## Risk: low/' "$work/pr-no-decision" >"$work/pr-low-no-decision"
sed "s/^Decision: .*$/Decision: $(printf 'go %.0s' $(seq 1 26))/" "$work/pr-good" >"$work/pr-decision-26-words"
sed "s/^Decision: .*$/Decision: $(printf 'go %.0s' $(seq 1 25))/" "$work/pr-good" >"$work/pr-decision-25-words"
sed 's/^Decision: .*$/Decision:/' "$work/pr-good" >"$work/pr-decision-empty"
awk -v filler="$(printf 'Reviewers notice one more consequence. %.0s' $(seq 1 6))" '
  /^Worst case:/ { print filler; print "" } { print }
' "$work/pr-decision-25-words" >"$work/pr-decision-uncounted"
expect pass pr-decision-present-at-medium "$here/lint.sh" pr "$work/pr-good" --risk medium
expect fail pr-decision-required-at-medium "$here/lint.sh" pr "$work/pr-no-decision" --risk medium
expect fail pr-decision-required-by-declared-level "$here/lint.sh" pr "$work/pr-no-decision"
expect pass pr-decision-optional-at-low "$here/lint.sh" pr "$work/pr-low-no-decision" --risk low
expect fail pr-decision-over-25-words "$here/lint.sh" pr "$work/pr-decision-26-words" --risk medium
expect pass pr-decision-at-25-words "$here/lint.sh" pr "$work/pr-decision-25-words" --risk medium
expect fail pr-decision-empty "$here/lint.sh" pr "$work/pr-decision-empty" --risk medium
expect pass pr-decision-not-in-impact-word-count "$here/lint.sh" pr "$work/pr-decision-uncounted" --risk medium

# needs label (commit)
printf 'docs(guide): restore the validation guide link\n\nImpact: Readers following the index reach the validation page again.\nNeeds: Confirm the link target before release.\n' >"$work/commit-needs"
printf 'docs(guide): restore the validation guide link\n\nImpact: Readers following the index reach the validation page again.\nNeeds: %s\n' "$(printf 'go %.0s' $(seq 1 26))" >"$work/commit-needs-long"
printf 'docs(guide): restore the validation guide link\n\nNeeds: Confirm the link.\nImpact: Readers following the index reach the validation page again.\n' >"$work/commit-needs-first"
expect pass commit-needs-label "$here/lint.sh" commit "$work/commit-needs" --risk low
expect fail commit-needs-over-25-words "$here/lint.sh" commit "$work/commit-needs-long" --risk low
expect fail commit-needs-before-impact "$here/lint.sh" commit "$work/commit-needs-first" --risk low

# rollback at high risk
rollback_commit() {
  printf 'ci(trigger): run docs checks only on pull requests\n\nImpact: Contributors get one docs run per pull request, not two.\nNeeds: Confirm the draft-PR check starts.\nWhy: Pushes ran the gate twice.\nRisk: high - trigger change; verified with a draft PR.\n' >"$work/$1"
  [ -z "${2:-}" ] || printf 'Rollback: %s\n' "$2" >>"$work/$1"
  printf '\n    [Contributor] --> [open PR into main] --> (one docs run)\n    [Contributor] --> [push branch]       --> (no docs run)\n' >>"$work/$1"
}
rollback_commit commit-rollback-none
rollback_commit commit-rollback-revert revert
rollback_commit commit-rollback-extra 'revert + rerun the backfill job'
rollback_commit commit-rollback-irreversible 'irreversible: phone numbers in the dropped column'
rollback_commit commit-rollback-bad 'undo it by hand'
rollback_commit commit-rollback-bare-plus 'revert +'
expect fail commit-rollback-required-at-high "$here/lint.sh" commit "$work/commit-rollback-none" --risk high
expect pass commit-rollback-revert "$here/lint.sh" commit "$work/commit-rollback-revert" --risk high
expect pass commit-rollback-revert-plus-step "$here/lint.sh" commit "$work/commit-rollback-extra" --risk high
expect pass commit-rollback-irreversible "$here/lint.sh" commit "$work/commit-rollback-irreversible" --risk high
expect fail commit-rollback-bad-form "$here/lint.sh" commit "$work/commit-rollback-bad" --risk high
expect fail commit-rollback-revert-plus-nothing "$here/lint.sh" commit "$work/commit-rollback-bare-plus" --risk high
awk '/^Rollback:/ { next } /^Risk:/ { print "Rollback: revert" } { print }' "$work/commit-rollback-revert" >"$work/commit-rollback-before-risk"
expect fail commit-rollback-before-risk "$here/lint.sh" commit "$work/commit-rollback-before-risk" --risk high
sed 's/^Risk: high.*$/Risk: medium - trigger change; verified with a draft PR./' "$work/commit-rollback-none" >"$work/commit-medium-no-rollback"
expect pass commit-rollback-not-needed-at-medium "$here/lint.sh" commit "$work/commit-medium-no-rollback" --risk medium

pr_high() {
  awk -v rollback="${2:-}" '
    /^## Risk: medium$/ { print "## Risk: high"; next }
    /^Decision:/ { print "Decision: approve the new description shape before merge."; next }
    /^\| Agent instructions/ { sub(/\| medium \|/, "| high |") }
    { print }
    /^Only agent instructions change/ && rollback != "" { print ""; print "Rollback: " rollback }
  ' "$work/pr-good" >"$work/$1"
}
pr_high pr-high-none
pr_high pr-high-revert revert
pr_high pr-high-extra 'revert + clear the CDN cache'
pr_high pr-high-irreversible 'irreversible: the dropped column data'
pr_high pr-high-bad 'maybe revert'
expect fail pr-rollback-required-at-high "$here/lint.sh" pr "$work/pr-high-none" --risk high
expect pass pr-rollback-revert "$here/lint.sh" pr "$work/pr-high-revert" --risk high
expect pass pr-rollback-revert-plus-step "$here/lint.sh" pr "$work/pr-high-extra" --risk high
expect pass pr-rollback-irreversible "$here/lint.sh" pr "$work/pr-high-irreversible" --risk high
expect fail pr-rollback-bad-form "$here/lint.sh" pr "$work/pr-high-bad" --risk high
expect pass pr-rollback-not-needed-at-medium "$here/lint.sh" pr "$work/pr-good" --risk medium
expect fail pr-high-needs-decision "$here/lint.sh" pr <(grep -v '^Decision:' "$work/pr-high-revert") --risk high

# not verified needs an owner at high risk
add_item() { ITEM=$3 awk '{ print } /^- scripts\/test.sh passes$/ { print ENVIRON["ITEM"] }' "$1" >"$work/$2"; }
add_item "$work/pr-high-revert" pr-high-nv-no-owner '- Not verified: the staging deploy.'
add_item "$work/pr-high-revert" pr-high-nv-owner '- Not verified: the staging deploy. owner: Dana, before merge.'
add_item "$work/pr-high-revert" pr-high-nv-upper '- NOT VERIFIED: the staging deploy.'
add_item "$work/pr-high-revert" pr-high-nv-wrapped '- Not verified: the staging deploy,
  which needs a release window. Owner: Dana.'
add_item "$work/pr-good" pr-medium-nv-no-owner '- Not verified: the staging deploy.'
expect fail pr-not-verified-needs-owner-at-high "$here/lint.sh" pr "$work/pr-high-nv-no-owner" --risk high
expect pass pr-not-verified-with-owner "$here/lint.sh" pr "$work/pr-high-nv-owner" --risk high
expect fail pr-not-verified-case-insensitive "$here/lint.sh" pr "$work/pr-high-nv-upper" --risk high
expect pass pr-not-verified-owner-on-wrapped-line "$here/lint.sh" pr "$work/pr-high-nv-wrapped" --risk high
expect pass pr-not-verified-no-owner-ok-at-medium "$here/lint.sh" pr "$work/pr-medium-nv-no-owner" --risk medium
sed 's/^Risk: high - trigger change; verified with a draft PR\./Risk: high - trigger change; not verified./' "$work/commit-rollback-revert" >"$work/commit-nv-no-owner"
sed 's/^Risk: high - trigger change; verified with a draft PR\./Risk: high - trigger change; Not Verified, owner: Dana./' "$work/commit-rollback-revert" >"$work/commit-nv-owner"
expect fail commit-not-verified-needs-owner-at-high "$here/lint.sh" commit "$work/commit-nv-no-owner" --risk high
expect pass commit-not-verified-with-owner "$here/lint.sh" commit "$work/commit-nv-owner" --risk high

# details fold
grep -v -e '^<details>' -e '^<summary>' -e '^</details>' "$work/pr-good" >"$work/pr-no-details"
grep -v '^</details>' "$work/pr-good" >"$work/pr-details-unclosed"
grep -v '^<details>' "$work/pr-good" >"$work/pr-details-unopened"
awk 'NR > 1 && prev == "" && /^<\/details>/ { lines[n] = ""; n--; } { lines[++n] = $0; prev = $0 } END { for (i = 1; i <= n; i++) print lines[i] }' "$work/pr-good" >"$work/pr-details-no-blank"
awk '/^<summary>/ { print; getline; next } { print }' "$work/pr-good" >"$work/pr-summary-no-blank"
awk '/^<details>/ { held = 1; next } held && /^<summary>/ { next } { print }' "$work/pr-good" | grep -v '^</details>' >"$work/pr-all-visible"
expect fail pr-details-required "$here/lint.sh" pr "$work/pr-no-details" --risk medium
expect fail pr-details-unclosed "$here/lint.sh" pr "$work/pr-details-unclosed" --risk medium
expect fail pr-details-unopened "$here/lint.sh" pr "$work/pr-details-unopened" --risk medium
expect fail pr-details-blank-before-close "$here/lint.sh" pr "$work/pr-details-no-blank" --risk medium
expect fail pr-details-blank-after-summary "$here/lint.sh" pr "$work/pr-summary-no-blank" --risk medium
expect fail pr-sections-must-be-inside-details "$here/lint.sh" pr "$work/pr-all-visible" --risk medium
# the 200-word prose limit excludes HTML tag lines
awk -v filler="$(printf 'word %.0s' $(seq 1 120))" '/^## Why/ { print; getline; print; print filler; next } { print }' "$work/pr-good" >"$work/pr-prose-near-limit"
awk -v long="$(printf 'tag %.0s' $(seq 1 90))" '/^<summary>/ { print "<summary>Why, risk, verification " long "</summary>"; next } { print }' "$work/pr-prose-near-limit" >"$work/pr-prose-big-summary"
awk -v filler="$(printf 'word %.0s' $(seq 1 120))" '/^## Why/ { print; getline; print; print filler; print ""; print filler; next } { print }' "$work/pr-good" >"$work/pr-prose-over"
expect pass pr-prose-near-limit "$here/lint.sh" pr "$work/pr-prose-near-limit" --risk medium
expect pass pr-html-tag-lines-not-counted "$here/lint.sh" pr "$work/pr-prose-big-summary" --risk medium
expect fail pr-prose-over-200 "$here/lint.sh" pr "$work/pr-prose-over" --risk medium

# invariants
printf '# example\n^notes\\.md$\tdraft notes stay private\tdocs-team\n\n^notes\\.\tdraft notes stay private\tdocs-team\n^src/never/\tnever matched\tnobody\n' >"$work/invariants.tsv"
(cd "$repo" && SO_WHAT_INVARIANTS="$work/invariants.tsv" "$here/facts.sh" --staged) >"$work/facts-inv" 2>/dev/null
expect pass facts-lists-touched-invariant grep -qx '  invariant: draft notes stay private (owner: docs-team)' "$work/facts-inv"
expect pass facts-lists-invariant-once test "$(grep -c 'invariant: ' "$work/facts-inv")" -eq 1
expect pass facts-skips-untouched-invariant test "$(grep -c 'never matched' "$work/facts-inv")" -eq 0
expect pass facts-invariant-raises-floor-to-medium grep -q '^risk: medium' "$work/facts-inv"
expect fail facts-prints-no-invariants-without-file grep -q 'invariant' "$work/facts-staged"
mkdir -p "$repo/.so-what"
printf '^notes\\.md$\trepo-level invariant\tsteward\n' >"$repo/.so-what/invariants.tsv"
facts_in_repo --staged >"$work/facts-inv-repo" 2>/dev/null
expect pass facts-reads-repo-invariants-file grep -q 'invariant: repo-level invariant (owner: steward)' "$work/facts-inv-repo"
rm -rf "$repo/.so-what"
expect pass lint-invariant-named-in-pr-risk "$here/lint.sh" pr "$work/pr-good" --risk medium --invariant "agent instructions"
expect fail lint-invariant-missing-in-pr-risk "$here/lint.sh" pr "$work/pr-good" --risk medium --invariant "billing ledger"
expect fail lint-invariant-repeatable "$here/lint.sh" pr "$work/pr-good" --risk medium --invariant "agent instructions" --invariant "billing ledger"
expect pass lint-invariant-named-in-commit-risk "$here/lint.sh" commit "$work/commit-rollback-revert" --risk high --invariant "draft PR"
expect fail lint-invariant-missing-in-commit "$here/lint.sh" commit "$work/commit-rollback-revert" --risk high --invariant "billing ledger"
expect pass lint-invariant-in-commit-rollback-line "$here/lint.sh" commit "$work/commit-rollback-extra" --risk high --invariant "backfill job"

# new risk-map rows (order matters: tests and docs win over security)
expect pass areas-security-before-tests test "$(area_of tests/auth/x.test.js)" = 'security high'
expect pass areas-security-before-docs test "$(area_of docs/security.md)" = 'security high'
expect pass areas-spec-dir-contract-is-interface test "$(area_of spec/openapi.yaml)" = 'interface high'
expect pass areas-spec-dir-tests-low test "$(area_of spec/helpers/util.js)" = 'tests low'
expect pass areas-security-high test "$(area_of src/auth.js)" = 'security high'
expect pass areas-security-dir-high test "$(area_of src/permissions/check.py)" = 'security high'
expect pass areas-authors-is-not-security test "$(area_of src/authors.js)" = 'source medium'
expect pass areas-interface-openapi-high test "$(area_of api/openapi.yaml)" = 'interface high'
expect pass areas-interface-proto-high test "$(area_of api/user.proto)" = 'interface high'
expect pass areas-flags-high test "$(area_of config/flags.json)" = 'flags high'
expect pass areas-data-sql-high test "$(area_of db/schema.sql)" = 'data high'
expect pass areas-data-prisma-high test "$(area_of prisma/schema.prisma)" = 'data high'
expect pass areas-infra-terraform-high test "$(area_of infra/main.tf)" = 'infra high'
expect pass areas-agents-medium test "$(area_of .claude/settings.json)" = 'agents medium'

# plan kind
cat >"$work/plan-good" <<'EOF'
<!-- so-what:start -->
## Plan

Contributors will see one docs-guardrails run per pull request, and
pushes to feature branches will start none. The expected worst case is a
wrong trigger letting unchecked docs reach main.

## Risk: high

Only the CI trigger changes; no data or interface moves.

## Verification plan

- Open a draft PR into main and watch the docs check start once.
- Push to a feature branch and confirm no docs run starts.
<!-- so-what:end -->
EOF
awk '/^## Verification plan/ { skip = 1 } /so-what:end/ { skip = 0 } !skip' "$work/plan-good" >"$work/plan-no-verification"
awk '/^- / { next } { print }' "$work/plan-good" >"$work/plan-no-items"
awk '/^## Risk/ { skip = 1 } /^## Verification plan/ { skip = 0 } !skip' "$work/plan-good" >"$work/plan-no-risk"
sed 's/^## Risk: high$/## Risk: severe/' "$work/plan-good" >"$work/plan-bad-risk"
awk '/^## Plan$/ { print; getline; print; print "Short plan only."; skip = 1; next } skip && /^## Risk/ { skip = 0; print ""} !skip' "$work/plan-good" >"$work/plan-too-short"
sed 's/^Contributors will see/Updated the trigger so contributors will see/' "$work/plan-good" >"$work/plan-edit-opener"
awk '/^## Risk/ { print "## Impact map"; print ""; print "```text"; print "[Contributor] --> [open PR] --> (one docs run)"; print "[Contributor] --> [push]    --> (no docs run)"; print "```"; print "" } { print }' "$work/plan-good" >"$work/plan-with-map"
awk '/^## Verification plan/ { print "## Verification"; next } { print }' "$work/plan-good" >"$work/plan-wrong-heading"
expect pass plan-good "$here/lint.sh" plan "$work/plan-good" --risk high
expect fail plan-missing-verification-plan "$here/lint.sh" plan "$work/plan-no-verification"
expect fail plan-verification-needs-item "$here/lint.sh" plan "$work/plan-no-items"
expect fail plan-missing-risk "$here/lint.sh" plan "$work/plan-no-risk"
expect fail plan-bad-risk-level "$here/lint.sh" plan "$work/plan-bad-risk"
expect fail plan-under-20-words "$here/lint.sh" plan "$work/plan-too-short"
expect fail plan-edit-verb-opener "$here/lint.sh" plan "$work/plan-edit-opener"
expect pass plan-optional-impact-map "$here/lint.sh" plan "$work/plan-with-map"
expect fail plan-wrong-verification-heading "$here/lint.sh" plan "$work/plan-wrong-heading"
expect fail plan-is-not-a-pr "$here/lint.sh" pr "$work/plan-good"
expect fail pr-is-not-a-plan "$here/lint.sh" plan "$work/pr-good"
sed 's/^## Risk: high$/## Risk: medium/' "$work/plan-good" >"$work/plan-below-floor"
expect fail plan-risk-below-floor "$here/lint.sh" plan "$work/plan-below-floor" --risk high

# upsert --show and --kind plan (gh stubbed)
mkdir -p "$work/bin"
cat >"$work/bin/gh" <<'EOF'
#!/usr/bin/env bash
if [ "$1 $2" = "pr view" ]; then cat "$GH_BODY"; else exit 0; fi
EOF
chmod +x "$work/bin/gh"
upsert_with_body() { local body=$1; shift; PATH="$work/bin:$PATH" GH_BODY="$body" "$here/upsert-pr.sh" "$@"; }
{ printf 'Intro.\n\n'; cat "$work/plan-good"; printf '\nFooter.\n'; } >"$work/body-with-plan"
upsert_with_body "$work/body-with-plan" 7 --show >"$work/shown" 2>/dev/null
expect pass upsert-show-prints-block diff -q "$work/shown" "$work/plan-good"
upsert_with_body "$work/body-plain" 7 --show >"$work/shown-none" 2>/dev/null
expect pass upsert-show-empty-without-block test ! -s "$work/shown-none"
expect fail upsert-show-refuses-malformed upsert_with_body "$work/body-unclosed" 7 --show
upsert_with_body "$work/body-with-plan" 7 "$work/pr-good" --risk medium --dry-run >"$work/replaced" 2>/dev/null
expect pass upsert-recap-replaces-plan-block grep -q '^## Impact$' "$work/replaced"
expect fail upsert-recap-drops-plan-heading grep -q '^## Plan$' "$work/replaced"
expect pass upsert-recap-keeps-footer grep -qx 'Footer.' "$work/replaced"
upsert_with_body "$work/body-plain" 7 "$work/plan-good" --kind plan --risk none --dry-run >"$work/plan-merged" 2>/dev/null
expect pass upsert-kind-plan-dry-run grep -q '^## Verification plan$' "$work/plan-merged"
expect fail upsert-default-kind-rejects-plan upsert_with_body "$work/body-plain" 7 "$work/plan-good" --risk none --dry-run
expect fail upsert-kind-plan-rejects-pr upsert_with_body "$work/body-plain" 7 "$work/pr-good" --kind plan --risk none --dry-run
expect fail upsert-rejects-unknown-kind upsert_with_body "$work/body-plain" 7 "$work/pr-good" --kind recap --risk none --dry-run
expect fail upsert-passes-invariant-to-lint upsert_with_body "$work/body-plain" 7 "$work/pr-good" --risk medium --invariant "billing ledger" --dry-run
expect pass upsert-invariant-satisfied upsert_with_body "$work/body-plain" 7 "$work/pr-good" --risk medium --invariant "agent instructions" --dry-run
expect fail upsert-requires-risk upsert_with_body "$work/body-plain" 7 "$work/pr-good" --dry-run

# mermaid impact maps (pull requests only)
pr_with_map() {
  cat >"$work/map.txt"
  awk -v fence="$2" -v mapfile="$work/map.txt" '
    /^```text$/ { print "```" fence; while ((getline row < mapfile) > 0) print row; close(mapfile); skip = 1; next }
    skip && /^```$/ { skip = 0; print; next }
    !skip { print }
  ' "$work/pr-good" >"$work/$1"
}
pr_with_map pr-mermaid-sequence mermaid <<'EOF'
sequenceDiagram
    Contributor->>Branch: push
    Branch-->>Contributor: no docs run
EOF
pr_with_map pr-mermaid-flowchart mermaid <<'EOF'
flowchart LR
    A[Contributor] --> B[open PR into main]
    B --> C(one docs run)
EOF
pr_with_map pr-mermaid-graph mermaid <<'EOF'
graph TD
    A[Contributor] ==> B[one docs run]
EOF
pr_with_map pr-mermaid-no-header mermaid <<'EOF'
    A[Contributor] --> B[one docs run]
    B --> C(done)
EOF
pr_with_map pr-mermaid-bad-direction mermaid <<'EOF'
flowchart
    A[Contributor] --> B[one docs run]
EOF
pr_with_map pr-mermaid-header-only mermaid <<'EOF'
flowchart LR
EOF
pr_with_map pr-mermaid-semicolon mermaid <<'EOF'
sequenceDiagram
    Contributor->>Branch: push; then wait
    Branch-->>Contributor: no docs run
EOF
pr_with_map pr-mermaid-file-name mermaid <<'EOF'
flowchart LR
    A[Contributor] --> B[docs-guardrails.yml]
EOF
pr_with_map pr-mermaid-no-arrow mermaid <<'EOF'
flowchart LR
    A[Contributor]
    B[one docs run]
EOF
pr_with_map pr-mermaid-too-long mermaid <<'EOF'
flowchart LR
    A1[a] --> B1[b]
    A2[a] --> B2[b]
    A3[a] --> B3[b]
    A4[a] --> B4[b]
    A5[a] --> B5[b]
    A6[a] --> B6[b]
    A7[a] --> B7[b]
    A8[a] --> B8[b]
    A9[a] --> B9[b]
    A10[a] --> B10[b]
    A11[a] --> B11[b]
    A12[a] --> B12[b]
    A13[a] --> B13[b]
    A14[a] --> B14[b]
    A15[a] --> B15[b]
EOF
pr_with_map pr-mermaid-fifteen-lines mermaid <<'EOF'
flowchart LR
    A1[a] --> B1[b]
    A2[a] --> B2[b]
    A3[a] --> B3[b]
    A4[a] --> B4[b]
    A5[a] --> B5[b]
    A6[a] --> B6[b]
    A7[a] --> B7[b]
    A8[a] --> B8[b]
    A9[a] --> B9[b]
    A10[a] --> B10[b]
    A11[a] --> B11[b]
    A12[a] --> B12[b]
    A13[a] --> B13[b]
    A14[a] --> B14[b]
EOF
expect pass pr-mermaid-sequence-valid "$here/lint.sh" pr "$work/pr-mermaid-sequence" --risk medium
expect pass pr-mermaid-flowchart-valid "$here/lint.sh" pr "$work/pr-mermaid-flowchart" --risk medium
expect pass pr-mermaid-graph-valid "$here/lint.sh" pr "$work/pr-mermaid-graph" --risk medium
expect fail pr-mermaid-missing-header "$here/lint.sh" pr "$work/pr-mermaid-no-header" --risk medium
expect fail pr-mermaid-flowchart-needs-direction "$here/lint.sh" pr "$work/pr-mermaid-bad-direction" --risk medium
expect fail pr-mermaid-header-only "$here/lint.sh" pr "$work/pr-mermaid-header-only" --risk medium
expect fail pr-mermaid-semicolon-in-sequence "$here/lint.sh" pr "$work/pr-mermaid-semicolon" --risk medium
expect fail pr-mermaid-file-name "$here/lint.sh" pr "$work/pr-mermaid-file-name" --risk medium
expect fail pr-mermaid-needs-arrow "$here/lint.sh" pr "$work/pr-mermaid-no-arrow" --risk medium
expect fail pr-mermaid-over-15-lines "$here/lint.sh" pr "$work/pr-mermaid-too-long" --risk medium
expect pass pr-mermaid-at-15-lines "$here/lint.sh" pr "$work/pr-mermaid-fifteen-lines" --risk medium
expect fail plan-mermaid-rejected "$here/lint.sh" plan <(awk '/^## Risk/ { print "## Impact map"; print ""; print "```mermaid"; print "flowchart LR"; print "    A[Contributor] --> B[docs run]"; print "```"; print "" } { print }' "$work/plan-good")
{ printf 'ci(trigger): run docs checks only on pull requests\n\nImpact: Contributors get one docs run per pull request, not two.\nWhy: Pushes ran the gate twice.\nRisk: high - trigger change; verified with a draft PR.\nRollback: revert\n\n```mermaid\nflowchart LR\n    A[Contributor] --> B[docs run]\n```\n'; } >"$work/commit-mermaid"
expect fail commit-mermaid-rejected "$here/lint.sh" commit "$work/commit-mermaid" --risk high

# worst case line (round 2)
grep -v '^Worst case:' "$work/pr-good" >"$work/pr-no-worst"
sed "s/^Worst case: .*$/Worst case: $(printf 'go %.0s' $(seq 1 21))/" "$work/pr-good" >"$work/pr-worst-21-words"
sed "s/^Worst case: .*$/Worst case: $(printf 'go %.0s' $(seq 1 20))/" "$work/pr-good" >"$work/pr-worst-20-words"
awk '/^Worst case:/ { w = $0; next } /^Decision:/ { print; print w; next } { print }' "$work/pr-good" >"$work/pr-worst-after-decision"
awk '/^Decision:/ { print "Reviewers should also note this."; print "" } { print }' "$work/pr-good" >"$work/pr-prose-between"
awk '/^Worst case:/ { print; print ""; next } { print }' "$work/pr-good" >"$work/pr-worst-blank-gap"
sed "s/^Worst case: .*$/Worst case: $(printf 'go %.0s' $(seq 1 20))/; s/^Decision: .*$/Decision: $(printf 'go %.0s' $(seq 1 25))/" "$work/pr-good" >"$work/pr-labels-at-limits"
expect fail pr-worst-case-required-at-medium "$here/lint.sh" pr "$work/pr-no-worst" --risk medium
expect pass pr-worst-case-optional-at-low "$here/lint.sh" pr "$work/pr-low-no-decision" --risk low
expect fail pr-worst-case-over-20-words "$here/lint.sh" pr "$work/pr-worst-21-words" --risk medium
expect pass pr-worst-case-at-20-words "$here/lint.sh" pr "$work/pr-worst-20-words" --risk medium
expect fail pr-worst-case-after-decision "$here/lint.sh" pr "$work/pr-worst-after-decision" --risk medium
expect fail pr-worst-case-not-directly-before-decision "$here/lint.sh" pr "$work/pr-prose-between" --risk medium
expect pass pr-worst-case-blank-line-before-decision "$here/lint.sh" pr "$work/pr-worst-blank-gap" --risk medium
expect pass pr-worst-case-and-decision-not-in-impact-count "$here/lint.sh" pr "$work/pr-labels-at-limits" --risk medium

# commit Needs required at high; none rejected at high
grep -v '^Needs:' "$work/commit-rollback-revert" >"$work/commit-high-no-needs"
sed 's/^Needs: .*$/Needs: None./' "$work/commit-rollback-revert" >"$work/commit-high-needs-none"
sed 's/^Needs: .*$/Needs: None./; s/^Risk: high/Risk: medium/' "$work/commit-rollback-revert" >"$work/commit-medium-needs-none"
sed 's/^Needs: .*$/Needs: Nonetheless confirm the draft PR check ran./' "$work/commit-rollback-revert" >"$work/commit-high-needs-nonetheless"
grep -v '^Needs:' "$work/commit-medium-no-rollback" >"$work/commit-medium-no-needs"
expect fail commit-needs-required-at-high "$here/lint.sh" commit "$work/commit-high-no-needs" --risk high
expect fail commit-needs-none-rejected-at-high "$here/lint.sh" commit "$work/commit-high-needs-none" --risk high
expect pass commit-needs-none-allowed-at-medium "$here/lint.sh" commit "$work/commit-medium-needs-none" --risk medium
expect pass commit-needs-optional-at-medium "$here/lint.sh" commit "$work/commit-medium-no-needs" --risk medium
expect pass commit-needs-none-prefix-word-is-not-none "$here/lint.sh" commit "$work/commit-high-needs-nonetheless" --risk high
sed 's/^Decision: .*$/Decision: None beyond normal review./' "$work/pr-high-revert" >"$work/pr-high-decision-none"
expect fail pr-decision-none-rejected-at-high "$here/lint.sh" pr "$work/pr-high-decision-none" --risk high
expect pass pr-decision-none-allowed-at-medium "$here/lint.sh" pr "$work/pr-good" --risk medium

# bold labels, case-insensitive rollback, field termination
sed 's/^Needs: /**Needs:** /; s/^Rollback: revert$/**Rollback:** Revert/' "$work/commit-rollback-revert" >"$work/commit-bold-labels"
sed 's/^Rollback: revert$/Rollback: IRREVERSIBLE: the dropped data/' "$work/commit-rollback-revert" >"$work/commit-rollback-upper"
awk '/^Rollback:/ { print; print "Co-Authored-By: Dana <dana@example.invalid>"; next } { print }' "$work/commit-rollback-revert" >"$work/commit-trailer-after-rollback"
awk '/^Needs:/ { print; print "Co-Authored-By: Dana <dana@example.invalid>"; next } { print }' "$work/commit-rollback-revert" >"$work/commit-trailer-after-needs"
sed 's/^Needs: .*$/Needs: Confirm the draft PR check ran,\n  then merge./' "$work/commit-rollback-revert" | awk '{ gsub(/\\n/, "\n"); print }' >"$work/commit-needs-indented-continuation"
sed 's/^Decision: /**Decision:** /; s/^Worst case: /**Worst case:** /' "$work/pr-good" >"$work/pr-bold-labels"
sed 's/^Rollback: revert$/**Rollback:** Revert/' "$work/pr-high-revert" >"$work/pr-bold-rollback"
awk -v a="$(printf 'go %.0s' $(seq 1 13))" '/^Decision:/ { print "Decision: " a; print "  " a; next } { print }' "$work/pr-good" >"$work/pr-decision-indented-26"
awk -v a="$(printf 'go %.0s' $(seq 1 13))" '/^Decision:/ { print "Decision: " a; print a; next } { print }' "$work/pr-good" >"$work/pr-decision-unindented-second-line"
expect pass commit-bold-labels "$here/lint.sh" commit "$work/commit-bold-labels" --risk high
expect pass commit-rollback-value-case-insensitive "$here/lint.sh" commit "$work/commit-rollback-upper" --risk high
expect pass commit-trailer-does-not-extend-rollback "$here/lint.sh" commit "$work/commit-trailer-after-rollback" --risk high
expect pass commit-trailer-does-not-extend-needs "$here/lint.sh" commit "$work/commit-trailer-after-needs" --risk high
expect pass commit-needs-indented-continuation "$here/lint.sh" commit "$work/commit-needs-indented-continuation" --risk high
expect pass pr-bold-decision-and-worst-case "$here/lint.sh" pr "$work/pr-bold-labels" --risk medium
expect pass pr-bold-rollback-case-insensitive "$here/lint.sh" pr "$work/pr-bold-rollback" --risk high
expect fail pr-decision-indented-continuation-counts "$here/lint.sh" pr "$work/pr-decision-indented-26" --risk medium
expect pass pr-decision-ends-at-unindented-line "$here/lint.sh" pr "$work/pr-decision-unindented-second-line" --risk medium

# map arrows and nodes (round 2)
map_commit commit-map-changed-marker-only <<'EOF'
    [Contributor] <- changed
    [Maintainer]  <- changed
EOF
map_commit commit-map-short-arrow <<'EOF'
    [Contributor] -> [open PR into main]
    [Contributor] -> [push branch]
EOF
map_commit commit-map-mixed-nodes <<'EOF'
    (Contributor) [opens PR] --> ok
    (Maintainer) --> [merges]
EOF
expect fail map-changed-marker-is-not-an-arrow "$here/lint.sh" commit "$work/commit-map-changed-marker-only" --risk high
expect pass map-short-arrow-accepted "$here/lint.sh" commit "$work/commit-map-short-arrow" --risk high
expect pass map-mixed-node-types-counted-per-type "$here/lint.sh" commit "$work/commit-map-mixed-nodes" --risk high
pr_with_map pr-mermaid-semicolon-header mermaid <<'EOF'
flowchart LR;
    A[Contributor] --> B[one docs run]
EOF
expect pass pr-mermaid-header-trailing-semicolon "$here/lint.sh" pr "$work/pr-mermaid-semicolon-header" --risk medium

# facts: comment lines in the map, and outside a git repo
printf '# risk map\n\n.\tsource\tmedium\n' >"$work/areas-commented.tsv"
(cd "$repo" && SO_WHAT_AREAS="$work/areas-commented.tsv" "$here/facts.sh" --staged) >"$work/facts-commented" 2>/dev/null
expect pass facts-skips-comment-and-blank-map-rows grep -q '^risk: medium (driven by source)' "$work/facts-commented"
mkdir -p "$work/not-a-repo"
expect fail facts-outside-git-fails "bash" -c "cd '$work/not-a-repo' && GIT_CEILING_DIRECTORIES='$work' '$here/facts.sh' --staged"
(cd "$work/not-a-repo" && GIT_CEILING_DIRECTORIES="$work" "$here/facts.sh" --staged) >"$work/facts-nogit" 2>&1 || true
expect pass facts-outside-git-says-why grep -q 'not inside a git repository' "$work/facts-nogit"

# AWK override and mmdc handling
expect pass lint-awk-env-override env AWK=awk "$here/lint.sh" pr "$work/pr-good" --risk medium
expect fail lint-awk-env-missing-interpreter env AWK=/nonexistent/awk "$here/lint.sh" pr "$work/pr-good" --risk medium
mkdir -p "$work/mmdc-launch" "$work/mmdc-parse"
printf '#!/usr/bin/env bash\necho "Error: Failed to launch the browser process" >&2\nexit 1\n' >"$work/mmdc-launch/mmdc"
printf '#!/usr/bin/env bash\necho "Parse error on line 2" >&2\nexit 1\n' >"$work/mmdc-parse/mmdc"
chmod +x "$work/mmdc-launch/mmdc" "$work/mmdc-parse/mmdc"
expect pass mmdc-launch-failure-is-skipped env PATH="$work/mmdc-launch:$PATH" "$here/lint.sh" pr "$work/pr-mermaid-sequence" --risk medium
expect fail mmdc-parse-error-fails env PATH="$work/mmdc-parse:$PATH" "$here/lint.sh" pr "$work/pr-mermaid-sequence" --risk medium

# forced negatives (subject, Impact, Worst case, Decision, Needs)
neg_commit() { sed "s/^Needs: .*/Needs: $2/" "$work/commit-good" >"$work/neg-$1"; }
neg_subject() { sed "1s/.*/$2/" "$work/commit-good" >"$work/neg-$1"; }
neg_pr() { sed "s/^$2: .*/$2: $3/" "$work/pr-good" >"$work/neg-$1"; }
neg_commit needs-not-but 'This is not a risk but a decision to confirm.'
neg_commit needs-no-longer 'Confirm the trigger no longer runs twice.'
neg_commit needs-instead 'Confirm the check instead of the rerun.'
neg_commit needs-opens-no 'No rerun is needed; confirm the check starts.'
neg_commit needs-clean 'Confirm the draft-PR check starts before merging.'
neg_commit needs-not-alone 'Confirm the check; do not merge before it starts.'
neg_subject subject-rather 'ci(guardrails): run docs checks rather than skipping them'
expect fail neg-needs-not-but "$here/lint.sh" commit "$work/neg-needs-not-but" --risk high
expect fail neg-needs-no-longer "$here/lint.sh" commit "$work/neg-needs-no-longer" --risk high
expect fail neg-needs-instead-of "$here/lint.sh" commit "$work/neg-needs-instead" --risk high
expect fail neg-needs-opens-with-no "$here/lint.sh" commit "$work/neg-needs-opens-no" --risk high
expect pass neg-needs-clean-passes "$here/lint.sh" commit "$work/neg-needs-clean" --risk high
expect pass neg-not-without-but-passes "$here/lint.sh" commit "$work/neg-needs-not-alone" --risk high
expect fail neg-subject-rather-than "$here/lint.sh" commit "$work/neg-subject-rather" --risk high
printf 'ci: this is not just a tweak\n' >"$work/neg-subject-not-just"
expect fail neg-subject-not-just "$here/lint.sh" subject "$work/neg-subject-not-just"
sed 's/^was verified\./was verified, which isn'"'"'t a diff recap./' "$work/pr-good" >"$work/neg-pr-impact-isnt"
expect fail neg-pr-impact-isnt "$here/lint.sh" pr "$work/neg-pr-impact-isnt" --risk medium
neg_pr pr-worst-never Worst\ case 'Never run this on a busy day.'
neg_pr pr-decision-not-only Decision 'Approve this, not only the trigger change.'
neg_pr pr-decision-its-not Decision 'It'"'"'s not urgent; approve before the release.'
expect fail neg-pr-worst-opens-never "$here/lint.sh" pr "$work/neg-pr-pr-worst-never" --risk medium
expect fail neg-pr-decision-not-only "$here/lint.sh" pr "$work/neg-pr-pr-decision-not-only" --risk medium
expect fail neg-pr-decision-its-not "$here/lint.sh" pr "$work/neg-pr-pr-decision-its-not" --risk medium

# example blocks in the references lint clean
extract() {
  awk -v heading="$2" '
    $0 == "## " heading { on = 1; next }
    on && !open && /^`+/ { match($0, /^`+/); open = RLENGTH; next }
    open { if ($0 ~ /^`+$/ && length($0) == open) exit; print }
  ' "$1"
}
refs="$here/../references"
extract "$refs/commit.md" Example >"$work/ref-commit"
extract "$refs/pull-request.md" Example >"$work/ref-pr"
extract "$refs/plan.md" "Plan example" >"$work/ref-plan"
expect pass ref-commit-example-lints "$here/lint.sh" commit "$work/ref-commit" --risk medium
expect pass ref-pr-example-lints "$here/lint.sh" pr "$work/ref-pr" --risk high
expect pass ref-pr-example-uses-mermaid grep -q '^```mermaid' "$work/ref-pr"
expect pass ref-plan-example-lints "$here/lint.sh" plan "$work/ref-plan" --risk medium
expect fail ref-commit-counter-example-rejected "$here/lint.sh" commit <(extract "$refs/commit.md" "Counter-example") --risk high

printf '%d passed, %d failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
