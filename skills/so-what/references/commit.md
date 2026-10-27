# Commit message shape

```text
<type>(<scope>): <outcome, imperative, 72 chars max, no period>

Impact: <who notices, and what is now different for them>
Needs: <what the reader must decide or do; required at high risk>
Why: <the problem or pressure that made this change necessary>
Risk: <low|medium|high> - <worst case, and how you checked>
Rollback: <high risk: revert | revert + <step> | irreversible: <loss>>

    <ASCII impact map, indented 4 spaces>

<optional: one short paragraph of notable implementation detail>
```

- `type`: feat, fix, docs, ci, build, chore, refactor, perf, test, style,
  revert. `scope` is the area from `facts.mjs` or a narrower name.
- The subject states the outcome for the reader. See the
  [example subject](example.md#commit-message).
- `Impact:` is required, first, 8-45 words. Its first sentence (30 words
  max) names the problem solved or the behavior changed, and for whom, in
  plain words a non-specialist can follow.
- `Needs:` is the PR `Decision:`, 25 words max. Required at high risk and
  never starting with "none" there; optional below.
- `Risk:` holds the worst case and what ran, or says `not verified`. `Why:`
  never guesses: mark an implied reason `(inferred)`.
- `Why:` and `Risk:` are required at medium and high risk, optional at low.
- `Rollback:` follows `Risk:`; required at high risk.
- Name every invariant `facts.mjs` lists in `Risk:` or `Rollback:`, at any
  risk level, and pass each to lint with `--invariant "<name>"`.
- The map is required at medium and high risk. It follows a blank line
  after the last label. Rules: [impact map](impact-map.md). Commits take
  ASCII only, no code fences.
- Wrap body lines at 72 characters. A field continues on indented lines
  and ends at the next label, a trailer such as `Co-Authored-By:`, or a
  blank line.
- Implementation detail goes after the labels, only when a future reader
  of `git log` needs it for a non-obvious choice.

## Example

[Worked example: commit message](example.md#commit-message), and
[the counter-example](example.md#counter-example) that `lint.mjs` rejects.
