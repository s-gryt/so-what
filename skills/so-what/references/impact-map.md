# Impact map

One diagram of cause and effect from the reader's side: who is affected,
joined by arrows to what now differs. It restates Impact visually and adds
no claim. Draw only what this change causes; an arrow the diff does not
support is as invented as a made-up Why. `lint.sh` checks the mechanics;
whether the diagram is true is on you.

## ASCII (commits always; a PR fallback)

```text
was: [EU account] --> [dollar invoice] --> (invoice sent back)
now: [EU account] --> [euro invoice] --> (paid in euros)
```

- Printable ASCII only: boxes use `+ - |`, flow uses `-->`, `==>`, `->`, or
  `|` over `v`. `<- changed` alone is not an arrow. No tabs or Unicode.
- 2-12 lines, at most 72 columns (commits: including the 4-space indent).
- At least 2 labeled nodes, written `[who or event]`, `(outcome)`, or a
  box, and at least 1 arrow. Brackets balance.
- Nodes name audiences and behavior, never files. Cause runs left to
  right. When behavior changed, draw before and after as two rows.
- Every box wall `|` has a `|`, `+`, `v`, or `^` directly above or below.

## Mermaid (pull requests: the default)

GitHub renders it on the PR page. Use `flowchart LR` with 3-6 nodes and
short plain-word labels. ASCII is an allowed fallback when it fits the PR
page.

- The first non-blank line is `sequenceDiagram`, `flowchart <dir>`, or
  `graph <dir>`; `<dir>` is `TD`, `TB`, `BT`, `RL`, or `LR`. A trailing
  `;` is fine.
- 2-15 non-blank lines, one arrow at least (`-->`, `->>`, `-->>`, `---`,
  `==>`), no file names, no `;` inside sequence message text.
- If `mmdc` is installed, `lint.sh` also parses the diagram (20 second
  limit). When it cannot launch a browser it warns and skips.
