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
  revert. `scope` is the area from `facts.sh` or a narrower name.
- The subject states the outcome ("invoice customers in their own currency"),
  not the edit ("add a currency column").
- `Impact:` is required, first, 8-45 words. Its first sentence (30 words
  max) names the problem solved or the behavior changed, and for whom, in
  plain words a non-specialist can follow.
- `Needs:` is the PR `Decision:`, 25 words max. Required at high risk and
  never starting with "none" there; optional below.
- `Risk:` holds the worst case and what ran, or says `not verified`. `Why:`
  never guesses: mark an implied reason `(inferred)`.
- `Why:` and `Risk:` are required at medium and high risk, optional at low.
- `Rollback:` follows `Risk:`; required at high risk.
- Name every invariant `facts.sh` lists in `Risk:` or `Rollback:`, at any
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

```text
feat(billing): invoice customers in their own currency

Impact: Finance can send invoices in euros or pounds, which lets us bill
the EU and UK accounts that require local-currency invoices. Customers
without a currency setting keep receiving dollar invoices.
Needs: Choose the first customers to bill in euros or pounds.
Why: EU and UK accounts require local-currency invoices before they pay.
Risk: medium - worst case, an invoice total differs by one cent from the
payment provider's total after rounding. Checked: EUR and GBP test
invoices matched the provider sandbox totals.

    was: [EU account] --> [dollar invoice] --> (invoice sent back)
    now: [EU account] --> [euro invoice] --> (paid in euros)
```

## Counter-example

```text
feat: add saml

Impact: Added saml.ts and updated the login route.
```

A diff-narrating message for the single sign-on change. The reader learns
which files moved, and nothing about who can now sign in, what could go
wrong, or what to decide. `lint.sh` rejects it: edit-verb opener, file
name, and no `Needs:`, `Why:`, `Risk:`, `Rollback:`, or map.
