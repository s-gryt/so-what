# Troubleshooting and self-test

## Failure modes

- `lint.sh` reports an edit-verb opener or file names in Impact: rewrite
  the sentence around the audience and consequence, not the edit.
- `lint.sh` reports risk below facts: raise the level, or explain in Risk
  why the change is still that risky; you cannot go below the floor.
- `lint.sh` reports a missing `Worst case:`, `Decision:`, or `Needs:`, or a
  missing `Rollback:`: add the line. `Decision:` and `Worst case:` are required at medium and
  high risk; `Rollback:` at high risk, in the form `revert`,
  `revert + <extra step>`, or `irreversible: <what is lost>`.
- `lint.sh` reports "not verified" without `owner:` at high risk: name who
  runs the check before merge, or run it yourself and report the result.
- `lint.sh` reports an invariant missing: `facts.sh` listed an invariant
  the change touches. Name it in the Risk section (commit: Risk or
  Rollback line) and say what the change does to it.
- `lint.sh` reports `<details>` problems: the block needs one
  `<details>` with `<summary>Why, risk, verification</summary>`, a blank
  line after the summary and before `</details>`, only `Impact` and
  `Impact map` above it, and everything else inside.
- `lint.sh` reports `impact map:` findings: a non-ASCII character, a
  misaligned box wall, a missing arrow, fewer than 2 nodes, a file name, or
  more than 72 columns. For Mermaid: a wrong first line, a `;` in a
  sequence message, no arrow, or `mmdc` failing to parse. Fix the diagram;
  do not delete it at medium or high risk. The lint cannot tell whether an
  arrow is true: re-check each against the diff.
- `facts.sh` exits 1 with no changes: nothing is staged or the branch
  equals its base. Stage files or check the base.
- `facts.sh` lists a touched invariant you think is wrong: the
  `.so-what/invariants.tsv` regex is too broad. Fix the file; do not ignore
  the line. See `invariants.example.tsv`.
- `upsert-pr.sh` reports the body changed while merging: someone else
  edited the description between the read and the write. Run it again. The
  script re-reads the body just before writing, which narrows but cannot
  close that window, because GitHub has no conditional body update. Avoid
  refreshing while a bot is still writing its summary.
- `gh pr edit` fails: `upsert-pr.sh <n> <block> --dry-run` prints the
  merged body; apply it by other means.
- `upsert-pr.sh <n> --show` prints nothing: the PR body has no recap or
  plan block yet.

## Self-test and evals

- `bash scripts/test.sh` checks the scripts (lint rules, map rules, upsert
  merge, facts, risk map, invariants, plan kind) and lints the example
  blocks in `references/`.
- [evals/README.md](../evals/README.md) defines the model-graded eval for
  description quality and records the latest results.
