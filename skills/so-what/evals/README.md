# so-what evals

Measures whether the skill makes descriptions explain impact rather than
narrate the diff, stay short, carry a correct ASCII impact map, and work as a
30-second briefing for a CTO or chief architect. Fixtures are self-contained,
scripts are plain `bash` + `awk` (Linux, macOS, Git Bash). `scripts/test.sh`
tests the skill's scripts and `selftest.sh` tests the helpers here; this
folder grades model output.

## Layout

| Path | Role |
| ---- | ---- |
| `fixtures/<case>/` | `base/` tree, `change.patch`, `mode`, `floor` (10 cases, c1 to c10) |
| `cases.md` | Key impacts, traps, map expectation per case. Generators never see it |
| `prompts/generate.md` | Generator template |
| `prompts/judge.md`, `prompts/headline-judge.md` | Full-output judge and headline judge templates |
| `setup.sh <case> <dir>` | Build a throwaway git repo for one case |
| `prepare.sh <run> --arm name=<skill-dir\|none>... [--cases c1,c2] [--runs N]` | Create every cell and its rendered generator prompt |
| `score.sh <run>` | Mechanical: lint with each arm's own `lint.sh`, map validity, word count |
| `headline.sh <file>` | Extract the headline view of one output: title (commits), Impact sentence, worst case or `Risk:`, `Decision:`/`Needs:`, map |
| `blind.sh <run> <case> [rN]` | Shuffle all arms into X1..Xn per run, write key and headline file |
| `judge-prep.sh <run>` | Run `blind.sh` for every case and run, render judge prompts |
| `aggregate.sh <run>` | Join both judge files with the keys, print per-arm means and spread |
| `cells.sh`, `selftest.sh` | Helper listing outputs; self-checks for the helpers |

A run directory looks like this:

```text
<run>/arms.tsv                          arm<TAB>skill-dir-or-none
<run>/<arm>/<case>/rN/{repo,skill,prompt.md,out.txt}
<run>/blind/<case>.rN.{md,key,headline.md}
<run>/judge/<case>.rN.{prompt.md,tsv,headline.prompt.md,headline.tsv}
```

The older `<run>/<arm>/<case>/out.txt` layout is read as run `r1`.

## Protocol

1. **Arms.** `baseline` (`none`: no skill), plus one arm per skill version
   under test, for example `previous` and `candidate`. Run
   `prepare.sh <run> --arm baseline=none --arm previous=<dir> --arm
   candidate=<dir> --runs 3`. It prints one prompt path per cell. Each skill
   arm gets a copy of its skill without `evals/` and `.omc/`, and is told to
   gather facts with `facts.sh --no-log`, so original commit messages are
   never visible.
2. **Generate.** Start one generator subagent per printed prompt (Haiku, in a
   fresh context). Each writes `out.txt` next to its prompt. Use at least 3
   runs per cell: single runs cannot separate a real difference from noise.
3. **Mechanical.** `score.sh <run>`: `core` = lint findings other than the
   map, using the `lint.sh` of the skill version that arm used (`none` arms
   use the current skill); `map` = ok, absent, or invalid; `words` = output
   length.
4. **Blind judges.** `judge-prep.sh <run>` shuffles outputs per case and run
   and prints the judge prompt paths. Start one subagent per prompt, Sonnet by
   default (Haiku judges had too much variance). The full-output judge writes
   `judge/<case>.rN.tsv`. The headline judge sees only `cases.md` and the
   headline file, never the patch or full outputs, and writes
   `judge/<case>.rN.headline.tsv`.
5. **Aggregate.** `aggregate.sh <run>` unblinds and prints, per arm, the means
   of each dimension, `core/25`, the standard deviation of core across runs,
   and a per-case table.
6. **Record** a dated entry under Results.

## Rubric

Integers 1 to 5: impact_first, accuracy, traps, risk, concision (a
time-pressed senior reader gets the decision from the first sentence), and
map (correct, readable, aligned ASCII that agrees with Impact and adds no
claim). `core` is the sum of the first five, out of 25. A separate headline
judge scores `headline`: from the title, first Impact sentence, `Decision:` or
`Needs:` line, and map alone, can a time-pressed CTO or chief architect answer
(a) what changed for whom, (b) the worst case, (c) what they must decide,
correctly per the key impacts.

A version passes when all of these hold:

- it beats baseline on impact_first, traps, and headline;
- it does not lose accuracy against the previous version;
- every output lints with its own skill's `lint.sh`;
- map averages 4 or more across valid maps.

Arms differ in structure (an older skill version may use another marker or no map at all), so a judge can sometimes tell arms apart despite blinding. This is unavoidable; `blind.sh` only normalizes the `impact-recap:` marker to `so-what:`. Do not read single-cell differences as proof.

Treat differences smaller than the standard deviation of core across runs as
noise.

## Results

### 2026-10-26, headline round (v4)

Haiku generators, Sonnet judges (main and headline), 10 cases (5 commit,
5 PR), 2 runs per cell, 60 outputs. Arms: `baseline` (no skill), `prev`
(the skill before this round), `v4` (decision, worst case, rollback,
invariants, folded detail, mermaid PR maps, forced-negative lint, real
business examples). Attribution trailers were stripped before blinding.

| Arm | Impact | Accuracy | Traps | Risk | Concision | Map | Headline | Core /25 | sd | Lint |
| --- | ------ | -------- | ----- | ---- | --------- | --- | -------- | -------- | -- | ---- |
| baseline | 1.90 | 3.35 | 2.40 | 1.05 | 2.80 | 1.00 | 1.85 | 11.50 | 0.14 | 0/20 |
| prev | 4.50 | 3.95 | 3.80 | 4.10 | 3.65 | 3.70 | 2.95 | 20.00 | 0.57 | 18/20 |
| v4 | 4.55 | 3.85 | 3.45 | 4.55 | 3.90 | 3.70 | 4.05 | 20.30 | 0.71 | 20/20 |

Findings:

- Headline view is the measurable gain: 4.05 against 2.95 (prev) and 1.85
  (baseline). A reader of the title, first sentence, worst case, decision,
  and map gets the point in 9 of 10 cases at 3.5 or above.
- Forced negatives ("no longer", "instead of", "rather than"): 0 of 20 v4
  outputs, 12 of 20 prev outputs, 5 of 20 baseline outputs.
- Risk (+0.45) and concision (+0.25) improved; core is level (20.30 vs
  20.00, inside the sd).
- Traps fell 0.35 and accuracy 0.10, mostly c1 (core 17.5 vs 23.5): v4
  misses that `branches` now filters pull requests. The headline format
  rewards the top consequence and can drop a second, subtler one.
- Map stays at 3.70, below the 4.0 target. Judges ask for maps that show
  the case's exact trap path.
- Not passed in full: map < 4 and accuracy dipped. Next: an Impact rule
  to name every trigger or audience the diff changes, then 3 runs per cell.
- The previous run of this round (`v3`, before the grounding rule and a
  judge fix that stopped penalizing mermaid maps) scored headline 4.15,
  accuracy 3.65, map 3.35.

### 2026-10-26

Haiku generators and judges, 5 cases (3 commit, 2 PR), 1 run per cell.
Differences under 3 points per case are noise (Haiku judge variance).

| Arm | Impact | Accuracy | Traps | Risk | Concision | Core /25 | Map /5 | Lint |
| --- | ------ | -------- | ----- | ---- | --------- | -------- | ------ | ---- |
| baseline | 1.80 | 3.00 | 2.80 | 1.00 | 3.40 | 12.0 | 1.0 | 0/5 |
| staged (committed skill) | 4.00 | 3.80 | 4.40 | 4.40 | 3.20 | 19.8 | 1.0 | 3/5 |
| unstaged (before this change) | 4.00 | 3.60 | 4.40 | 4.40 | 3.80 | 20.2 | 1.0 | 4/5 |
| final, map only | 4.40 | 3.80 | 4.20 | 4.40 | 3.20 | 20.0 | 3.8 | 5/5 |
| final, map + brevity | 4.20 | 3.80 | 4.40 | 4.40 | 3.40 | 20.2 | 3.8 | 5/5 |

Findings:

- Both skill versions beat baseline by about 8 core points (12.0 to 20).
  The unstaged changes did not change description quality measurably (20.2
  vs 19.8); they added the repo-overridable risk map and made the skill
  portable.
- The impact map is the measurable gain: 5/5 outputs carry a valid map, judged
  3.8/5; no earlier arm drew one. Lint compliance rose to 5/5 (staged 3/5,
  unstaged 4/5), though part of that is the lint now accepting the new shape.
- Brevity limits (lead sentence 30 words, Impact 70, recap 200) moved
  concision only from 3.2 to 3.4: inside noise. Output shrank 787 to 755
  words total. Concision stays the weakest dimension and is not shown to be
  fixed. Next: tighten the Changes and Verification guidance, then re-run
  with 3 runs per cell.
- c3 map scored 3 (below the 4 target): the judge found the sync-ref arrow
  only partly supported.
