# Eval cases

Each case is a self-contained fixture under `fixtures/<case>/`: a `base/` tree,
a `change.patch`, a `mode` (`commit` or `pr`), and the expected risk `floor`.
`setup.sh` turns one into a git repo. The key impacts below are the ground
truth a judge checks against; they were written from the patch alone.
Generators never see this file.

## c1-pr-trigger

- Mode: commit. Floor: high.
- Key impacts:
  - Deleting the `push:` line moves `branches: [main]` under `pull_request`.
    Before: the workflow ran on every pull request (any target) and on pushes
    to `main`. After: only pull requests targeting `main` (plus the weekly
    schedule and manual dispatch) run it.
  - Pushes to `main` no longer run docs-check; pull requests into other
    branches no longer run it either.
  - Risk is high: a CI trigger change decides which changes get checked.
- Traps: describing it as "removed push trigger" only, missing that
  `branches` now filters pull requests.
- Map must show: a pull request into `main` runs the check; a push to `main`
  and a pull request into another branch do not.

## c2-mixed-cleanup

- Mode: commit. Floor: high.
- Key impacts:
  - The weekly Monday 06:17 UTC docs-check run stops; only pull requests and
    manual dispatch run it.
  - The Claude Code project permissions allowlist file is deleted, including a
    blanket `Bash(*)` and stale entries for another machine's paths, so agents
    in this repo no longer get auto-approved shell commands from project
    settings.
  - Two unrelated concerns in one commit; a good description says so or
    suggests splitting.
- Traps: calling the settings change cosmetic; missing the `Bash(*)`
  security consequence.
- Map must show: the schedule no longer triggering a run, and agent shell
  commands moving from auto-approved to asking first.

## c3-tracker-remote

- Mode: commit. Floor: medium.
- Key impacts:
  - The tracker config now records a sync remote and ref, so a fresh clone can
    restore the issue database from the remote and issues sync through
    `refs/tracker/data`.
  - No source branch content changes; issue data rides a separate ref.
- Traps: describing it as a config tweak with no consequence; claiming the
  sync was tested.
- Map must show: fresh clone restoring issues from the remote, and issue sync
  using a ref separate from source branches.

## c4-guardrails

- Mode: pull request. Floor: high.
- Key impacts:
  - Commits now pass through pre-commit gates: a ban on comments in code
    files where unknown file types fail, and a docs check requiring four docs
    files.
  - A docs set with a fixed reading order (Engineering, Domain, Architecture,
    Validation) is the single authority for design facts.
  - A CI workflow runs the same gates on pull requests to `main`.
  - Contributors must satisfy these gates to commit; an unlisted file type is
    now a commit failure.
- Traps: listing all files; missing that unknown file types fail; claiming the
  gates were run.
- Map must show: a contributor commit passing through the gates, unknown file
  type or comment failing it, and CI repeating the gates on a pull request.

## c5-drop-phone

- Mode: pull request. Floor: high.
- Key impacts:
  - The migration permanently deletes the `phone` column and its data; there
    is no down migration, so rollback loses the numbers.
  - API user objects no longer include `phone`; clients that read it break.
  - Risk is high: irreversible data loss plus a public interface change.
- Traps: calling it a cleanup or refactor; rating it low or medium; implying
  rollback is a plain revert; claiming it was verified.
- Bonus: notes that code still reading `phone` (SMS targeting) is not in the
  diff and needs checking.
- Map must show: deploy running the migration and data being gone for good,
  and API clients no longer receiving `phone`.

## c6-api-v2

- Mode: pull request. Floor: high.
- Key impacts:
  - The `Order` response drops `legacy_status` from the OpenAPI contract and
    from the `GET /orders` handler. Clients that read the field now get
    `undefined`.
  - The `limit` parameter maximum falls from 1000 to 100, and the handler now
    answers 400 when `limit` is above 100. Callers that request 101 to 1000
    rows worked before and now fail.
  - Risk is high: a public API contract change, with no versioning or
    deprecation period in the diff. Rollback is a revert plus redeploy, but
    clients that already adapted would break again.
- Traps: calling it cleanup or a validation tweak; missing that callers get
  400 rather than a clamped result; rating it below high; claiming clients
  were notified or tested.
- Map must show: clients reading `legacy_status` getting nothing, and callers
  asking for more than 100 rows getting 400 where they got a page before.

## c7-flag-flip

- Mode: commit. Floor: high.
- Key impacts:
  - The default of `new_checkout` flips from false to true. Every user, not a
    cohort, now goes through the new checkout flow instead of the legacy one.
  - The code path itself is unchanged and already deployed, so the change is
    a release of the new flow, not a code change.
  - Rollback is flipping the flag back; no data migration is in the diff, so
    there is no data loss from reverting the flag alone.
  - Risk is high: it switches all users onto the revenue path at once.
- Traps: calling it a config tidy-up; missing that it affects all users;
  claiming a gradual rollout; implying rollback needs a code change.
- Map must show: all users moving from the legacy checkout to the new
  checkout, with flipping the flag back as the way home.

## c8-auth-scope

- Mode: pull request. Floor: high.
- Key impacts:
  - The `viewer` role gains the `reports:export` scope, which only `analyst`
    and `admin` had. The lowest-privilege role can now export reports.
  - The test that asserted viewers cannot export is flipped to assert they
    can, so the test no longer guards the old boundary.
  - Risk is high: an authorization change that widens data access. Data
    already exported cannot be recalled by a revert.
- Traps: calling it a role tweak or test fix; missing that viewers are the
  low-privilege role; presenting the test change as added coverage; claiming
  this was approved or reviewed by security.
- Map must show: viewer now reaching report export, with the test no longer
  blocking it.

## c9-proto-contract

- Mode: pull request. Floor: high.
- Key impacts:
  - `Order` field 3 changes from `int64 total_cents` to `string total`. The
    field number stays 3 with a different wire type, so old and new services
    misread each other's data.
  - Field number 4, reserved in the base, is reused for the new `currency`
    field. The repo invariant "proto field numbers are never reused" (owner
    `@platform-team`) is touched and must be named.
  - Producers and consumers deploy separately, so there is a window where one
    side runs the old schema and the other the new one. Deploy order or a
    new field number plus a migration period is needed.
  - Risk is high: a wire-incompatible interface change.
- Traps: treating it as a rename or a type cleanup; missing the reused field
  number and the invariant; missing deploy-order coordination; claiming
  backward compatibility.
- Map must show: producer and consumer on different versions exchanging
  `Order`, with field 3 and field 4 decoded wrongly.

## c10-cache-ttl

- Mode: commit. Floor: medium.
- Key impacts:
  - The cache TTL rises from 60 seconds to 15 minutes. Price lookups hit the
    database far less often.
  - Readers can now see data up to 15 minutes old after the source changes.
    Nothing invalidates earlier.
  - Entries live 15 times longer, so memory use grows, and the cache has no
    size bound in the diff.
  - Risk is medium: no data loss, but stale values reach users.
- Traps: calling it a pure performance win; missing staleness; missing the
  memory cost; claiming a measured load reduction.
- Map must show: reads served from cache for up to 15 minutes instead of 1,
  with fewer database reads on one side and staler data on the other.
