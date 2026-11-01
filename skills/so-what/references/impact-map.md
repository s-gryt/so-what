# Impact map

One diagram of cause and effect from the reader's side: who is affected,
joined by arrows to what now differs. It restates Impact visually and adds
no claim. Draw only what this change causes; an arrow the diff does not
support is as invented as a made-up Why. `lint.mjs` checks the mechanics;
whether the diagram is true is on you.

## One logic, two formats

ASCII and mermaid draw the same map. The content rules below apply to
both. The format is a preference: ASCII is the default, and the user may
ask for mermaid in a PR or plan. A commit uses ASCII, because `git log`
shows plain text.

- Nodes name audiences and behavior, never files.
- At least 2 labeled nodes and at least 1 arrow.
- Cause runs left to right. When behavior changed, draw before and after.
- Keep labels short, in plain words.

Examples: the [commit message](example.md#commit-message), the
[pull request block](example.md#pull-request-block), and the
[mermaid option](example.md#mermaid-option). All three draw one map.

## ASCII syntax

A commit indents the map 4 spaces. A PR or plan puts it in a `text` fence.

- Printable ASCII only: boxes use `+ - |`, flow uses `-->`, `==>`, `->`, or
  `|` over `v`. `<- changed` alone is not an arrow. No tabs or Unicode.
- Nodes are `[who or event]`, `(outcome)`, or a box. Brackets balance.
- Before and after go on two adjacent rows, each a full path from cause
  to outcome. A blank line ends the map, so keep none inside it.
- 2-12 lines, at most 72 columns (commits: including the 4-space indent).
- Every box wall `|` has a `|`, `+`, `v`, or `^` directly above or below.

## Mermaid syntax

GitHub renders a `mermaid` fence on the PR page.

- The first non-blank line is `sequenceDiagram`, `flowchart <dir>`, or
  `graph <dir>`; `<dir>` is `TD`, `TB`, `BT`, `RL`, or `LR`. A trailing
  `;` is fine. Use `flowchart LR` for left-to-right cause, with 3-6
  nodes. Choose mermaid when the flow branches or needs more than 3 rows.
- Before and after go on two labeled edges (`-->|before|`, `-->|after|`).
- Arrows: `-->`, `->>`, `-->>`, `---`, `==>`. No `;` inside sequence
  message text.
- 2-15 non-blank lines.
- Lint does not check the before/after edges or the node count.
- If `mmdc` is installed, `lint.mjs` also parses the diagram (20 second
  limit). When it cannot launch a browser it warns and skips.
