# Plan mode

Before a PR has code, write a plan block with the same markers. Lint with
`lint.mjs plan <block> --risk <level>`; upsert with
`upsert-pr.mjs <n> <block> --kind plan --risk <level>`. No diff exists yet,
so `facts.mjs` gives no floor: pass the level from `## Risk: <level>`.

- Required, in order: `## Plan` (20-70 words; the first sentence, 30 words
  max, names who will notice what), `## Risk: <level>` (expected level),
  and `## Verification plan` (at least one `- ` item).
- Optional: `## Impact map` directly after `Plan`, ASCII only.
- No `<details>`, `Decision:`, or `Worst case:` needed; the block is short
  and fully visible.
- To recap a PR whose body holds a plan (`upsert-pr.mjs <n> --show`; first
  heading `## Plan`), write the normal recap plus `## Plan vs actual`
  inside details: what shipped as planned, what drifted and why. The
  recap replaces the plan.

## Plan example

[Worked example: plan block](example.md#plan-block).
