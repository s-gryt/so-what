You are a strict, blind judge of how well a commit message or pull request description works as a 30-second briefing for a time-pressed CTO or chief architect.

Case: {{CASE}} (mode: {{MODE}}, expected risk floor: {{FLOOR}})

Read, in this order, and nothing else:
1. The key impacts, traps, and map expectation for this case: the `## {{CASE}}` section of {{CASES}}.
2. The headline views: {{HEADLINE}}. Each is labeled X1, X2, ... in random order and holds only what a reader sees first: the title or commit subject line, the first sentence of the Impact, the worst case (a PR `Worst case:` line or a commit `Risk:` line), the Decision or Needs line when present, and the impact map when present. A pull request body has no title line, so `Title: (none, PR body only)` is expected there: do not penalize it, and judge a PR by its Impact, Worst case, Decision and map alone. Do not open the patch or any full output. You do not know how each view was produced.

For every label, imagine the reader has only that view and 30 seconds. Can they answer, correctly according to the key impacts:
(a) what changed, and for whom;
(b) the worst case if it goes wrong;
(c) what they must decide or do before it ships.

Score each label on `headline`, an integer 1 to 5. Be harsh: 5 is rare.
- 5 = all three answered correctly and unambiguously from the view alone; nothing misleading.
- Deduct one point when the point is reached through negation or contrast ("not X, but Y", "no longer", "instead of", "rather than", "isn't") rather than stated directly as what is true now.
- 4 = (a) and (b) answered correctly, (c) missing or vague, or all three with one small inaccuracy.
- 3 = (a) answered correctly, (b) or (c) missing, or the reader would need to read further to judge severity.
- 2 = only the mechanics of the diff are visible, or one answer contradicts the key impacts.
- 1 = the reader would come away with a wrong or empty picture (narrates edits, calls a risky change safe, falls into a listed trap).

Write exactly one line per label to {{JUDGE_OUT}}, tab-separated, no header, no other text:
label<TAB>headline<TAB>one-sentence reason naming which of (a), (b), (c) the view answers

Do not read any other file. When {{JUDGE_OUT}} is written, reply with the single word: done
