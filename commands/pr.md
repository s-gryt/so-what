---
description: Write an impact-first pull request description with an impact map for this branch
argument-hint: "[number]"
---

Use the `so-what` skill to write the pull request recap block for this branch. Argument: `$ARGUMENTS`

If a pull request number is given, update that pull request's description in place. Ground the text in the real diff, include the impact map when the risk floor is medium or high (ASCII by default, a `mermaid` `flowchart LR` as an option), run the skill's lint step, and show the result before editing anything on GitHub.
