# so-what (`sw`)

An agent skill that writes commit messages and pull request descriptions around
**impact** (who notices, what behaves differently, what could break, how it was
verified), with a short impact map and a decision line, instead of narrating the
diff. It grounds the text in the real diff,
sets a risk floor from the files touched, lints the result, and updates an
existing PR description in place without touching hand-written notes.

Works with Claude Code, Codex, GitHub Copilot, and Antigravity.

## Install

### npx (all agents)

```bash
npx github:s-gryt/so-what --agent all          # this project
npx github:s-gryt/so-what -g -a claude,codex   # your user account
npx github:s-gryt/so-what list                 # what is installed where
```

Without `--agent`, it installs for agents it detects in the target. Existing
installs are kept unless you pass `--force`. `--dry-run` prints the plan.

| Agent          | Skill (project)            | Skill (global)                      | Slash command                                                                 |
| -------------- | -------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| Claude Code    | `.claude/skills/`          | `~/.claude/skills/`                 | `/sw:commit`, `/sw:pr` (`.claude/commands/sw/`)|
| Codex          | `.agents/skills/`          | `~/.agents/skills/`                 | `/prompts:sw-commit`, `/prompts:sw-pr` (global only, `~/.codex/prompts/`)                    |
| GitHub Copilot | `.github/skills/`          | `~/.copilot/skills/`                | `sw-commit`, `sw-pr` prompt files (project only, `.github/prompts/`)                |
| Antigravity    | `.agent/skills/`           | `~/.gemini/antigravity/skills/`     | `sw-commit`, `sw-pr` workflows (`.agent/workflows/`, global: `global_workflows/`)   |

### Claude Code plugin

```text
/plugin marketplace add s-gryt/so-what
/plugin install sw@so-what
```

### Skills CLI

The skill lives at `skills/so-what/SKILL.md`, the layout the open
`skills` CLI discovers:

```bash
npx skills add s-gryt/so-what
```

### Manual

Copy `skills/so-what/` into any agent's skills directory from the table.

## Use

Ask the agent for a commit message or PR description, or run `/sw:commit`,
`/sw:pr`, or `/sw:pr <number>` (Codex, Copilot, Antigravity: `sw-commit`, `sw-pr`). The skill needs `git`, `bash`, `awk`,
and (for pull requests) the `gh` CLI.

## Customize the risk map

`skills/so-what/scripts/areas.tsv` maps paths to an area and a risk floor
(first match wins, last row is a catch-all). Areas: agents, ci, data,
infra, tests, docs, security, interface, flags, deps, source. Override per
repo with `.so-what/areas.tsv` at the repo root or `SO_WHAT_AREAS=<file>`.

Name the architectural rules your repo protects in
`.so-what/invariants.tsv` (or `SO_WHAT_INVARIANTS=<file>`): `path-regex`,
`invariant`, `owner`, tab-separated. Touching a matching path lists the
invariant and its owner, raises the floor to at least medium, and makes
lint require the invariant's name in the Risk section. See
`skills/so-what/references/invariants.example.tsv`.

## Plan mode

Before a PR has code, the agent can write a short plan block (`## Plan`,
expected risk, verification plan) with `upsert-pr.sh <n> <block> --kind
plan`. The later recap adds `## Plan vs actual` and replaces it.
`upsert-pr.sh <n> --show` prints the current block.

## Develop

```bash
bash skills/so-what/scripts/test.sh    # lint, upsert, and facts self-test
node bin/cli.mjs --dir /tmp/demo --agent all --dry-run
```

`skills/so-what/evals/` holds fixtures, scripts, and results of the model-graded eval.

## License

[MIT](LICENSE) (http://opensource.org/license/MIT), Copyright (c) 2026 Sergii Grytsaienko.
