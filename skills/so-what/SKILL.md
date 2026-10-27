---
name: so-what
description: Write commit messages and pull request descriptions that lead with impact (who notices, what behaves differently, what could break, how it was verified) and skip diff narration. Use whenever you create a git commit, open a pull request, update a pull request description after new pushes, plan a pull request before code exists, or the user asks for a commit message, PR summary, PR description, change recap, or impact summary.
---

# So what?

Short name: `sw` (`/sw:commit`, `/sw:pr`).

Your text says what is now different in the world, and whether the reader
can trust it.

## The headline view

The title or subject, the first sentence of Impact, `Worst case:`,
`Decision:` (commit: `Needs:`), and the map carry the whole message. Before
linting, read back only that view and answer each question in one line. If
an answer needs the rest of the text, rewrite.

1. What was wrong, and what is different for whom?
2. What is the worst case?
3. What must the reader decide?

## The impact test

Would the sentence stay true with completely different code? Yes: impact.
No: diff narration; cut it. The first Impact sentence names the problem solved or the change in behavior for a named
audience, in plain words. No edit-verb opener (updated, added, removed),
no file names, no internal jargon or CI step names a non-specialist cannot
parse. Open with what was broken, blocked, or exposed, and for whom; then what is different now.

## Say what is true now

State the point and move on, in a collaborative tone. Do not frame through contrast or negation ("not X,
but Y", "no longer", "instead of", "rather than", "not just", "isn't", a
sentence opening with No, Not, or Never). `lint.mjs` flags these in the
subject, Impact, `Worst case:`, `Decision:`, and `Needs:` with `forced
negative: state what is true now`.

## Ground truth comes from the diff

Only the diff supports what changed. Every behavior the diff changes gets
named, with its full reach ("every user", "any client reading `phone`").
The worst case is the worst consequence the diff makes possible; a
consequence it does not support is invented, same as an invented Why.
Run scripts from the repo root, by this skill's absolute path.

```bash
node <skill>/scripts/facts.mjs --staged   # before a commit
node <skill>/scripts/facts.mjs            # before a PR (base: origin/main)
node <skill>/scripts/facts.mjs --base <rev> --head <rev>
```

`facts.mjs` prints commits, per-area counts, touched invariants, and a risk
floor from [`areas.tsv`](scripts/areas.tsv): first match wins, `#` and
blank lines are skipped, a deleted file raises it to medium, a touched
invariant raises it to medium. Repos override with `.so-what/areas.tsv` /
`SO_WHAT_AREAS` and add invariants in `.so-what/invariants.tsv` /
`SO_WHAT_INVARIANTS` ([example](references/invariants.example.tsv)). Rate
risk higher than the floor when the diff justifies it; never lower. Read
the real diff; `--no-log` hides subjects.

## Risk levels change the text

- Medium or high: add the impact map, the worst case, and a decision line.
  For changed config, rules, or interfaces describe the effective behavior
  before and after.
- High: add `Rollback:` (`revert`, `revert + <extra step>`, or
  `irreversible: <what is lost>`).
- Any level: name each touched invariant in Risk.
- Maps: a PR defaults to a `mermaid` `flowchart LR`; commits use ASCII.
  Rules: [impact map](references/impact-map.md).

## Never invent the why

`Why` comes from the user, task, issue, or session. Otherwise ask; if you
cannot, state what the diff evidently fixes plus `(inferred)`, or write
`not stated`.

## Verification is what ran

Name the checks that ran in this session and their results; a check you
only read about in the diff did not run. Otherwise say `not verified`
and name the check. At medium or high risk a health check, smoke
test, lint, or "it compiles" is not proof; proof exercises the changed
behavior. At high risk every `not verified` names `owner:`, who runs it
before merge.

## Creating a commit

1. Stage one logical change; split unrelated areas. If you cannot, give
   each concern its own Impact sentence and take type and scope from the
   riskiest.
2. Run `facts.mjs --staged`; note the floor and invariants.
3. Write the message to a temp file, shaped per
   [commit.md](references/commit.md).
4. Do the headline check, then `node <skill>/scripts/lint.mjs commit <file>
   --risk <floor>` plus `--invariant "<name>"` for each touched one. Fix
   every finding.
5. `git commit -F <file>`, then any attribution trailer the harness needs.

## Creating or updating a pull request

1. Push. Run `facts.mjs` (`--base <target>` if not main); read the full diff
   and `git log`.
2. Write the block per [pull-request.md](references/pull-request.md).
3. Do the headline check, then `lint.mjs pr <block> --risk <floor>` with an
   `--invariant "<name>"` each. Title: `lint.mjs subject <title-file>`.
4. New PR: `gh pr create --title "<title>" --body-file <body>`; the body is
   the block, markers included, plus any required footer.
5. Existing PR: `node <skill>/scripts/upsert-pr.mjs <n> <block> --risk
   <floor> --invariant "<name>"`. `--risk` is required. It lints, then
   replaces only the marked block. `--dry-run` previews.
6. After a behavior-changing push, regenerate and upsert again.

Before code exists, see [plan mode](references/plan.md). Lint failures and
self-test: [troubleshooting](references/troubleshooting.md).
