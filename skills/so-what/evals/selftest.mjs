#!/usr/bin/env node
// Self-checks for the eval helper scripts (no model, no repo needed).
//   selftest.mjs
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { here, cat, byteSort } from './lib.mjs';

const work = fs.mkdtempSync(cat(os.tmpdir(), 'so-what-selftest-'));
// Windows can hold a file open briefly (EBUSY); a leftover temp dir is harmless.
process.on('exit', () => {
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  } catch { /* leave it */ }
});
let fails = 0;

function check(name, expected, actual) {
  if (expected === actual) process.stdout.write(`ok   ${name}\n`);
  else {
    process.stdout.write(`FAIL ${name}\n--- expected\n${expected}\n--- actual\n${actual}\n`);
    fails++;
  }
}

// run one eval script; returns { status, out } with trailing newlines removed
function node(script, args, env) {
  const r = spawnSync(process.execPath, [cat(here, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: (r.stdout || '').replace(/\n+$/, ''), err: r.stderr || '' };
}
const write = (file, text) => fs.writeFileSync(file, text);
const ls = (dir) => byteSort(fs.readdirSync(dir).filter((n) => !n.startsWith('.'))).join(' ');

// commit: wrapped Impact and Risk, Needs, indented map
write(
  cat(work, 'commit.txt'),
  `Gate docs-check to pull requests into main

Impact: Pushes to main and PRs into other branches no longer run
docs-check, e.g. contributors lose a safety net. Weekly runs stay.
Risk: high. A broken docs page can now reach main
unchecked.
Needs: Confirm main requires
reviews.
Why: The push trigger shadowed branches.

    PR -> main  ==> check runs
    push main   ==> no check
`,
);
check(
  'commit',
  `Title: Gate docs-check to pull requests into main
Impact: Pushes to main and PRs into other branches no longer run docs-check, e.g. contributors lose a safety net.
Risk: high.
Needs: Confirm main requires reviews.
Map:
    PR -> main  ==> check runs
    push main   ==> no check`,
  node('headline.mjs', [cat(work, 'commit.txt')]).out,
);

// PR: leading title line, Worst case, wrapped bold Decision, json fence ignored, map fence kept
write(
  cat(work, 'pr.txt'),
  `Narrow order totals to strings

<!-- so-what:start -->
## Impact

Services deploying separately misread \`Order\` totals. Reusing field 4 breaks an invariant.

Worst case: Orders are billed
at the wrong amount.
**Decision:** Agree a deploy order
before merging.

## Impact map

\`\`\`text
producer(new) --f3--> consumer(old) ==> misdecode
\`\`\`

<details>
<summary>Why, risk, verification</summary>

## Changes
\`\`\`json
{ "before": 1 }
\`\`\`
</details>
<!-- so-what:end -->
`,
);
check(
  'pr',
  `Title: Narrow order totals to strings
Impact: Services deploying separately misread \`Order\` totals.
Worst case: Orders are billed at the wrong amount.
Decision: Agree a deploy order before merging.
Map:
\`\`\`text
producer(new) --f3--> consumer(old) ==> misdecode
\`\`\``,
  node('headline.mjs', [cat(work, 'pr.txt')]).out,
);

// a json fence is never the map; an unlabeled fence under ## Impact map is
write(cat(work, 'pr2.txt'), '<!-- so-what:start -->\n## Impact\n\nUsers get X. More text.\n\n## Impact map\n\n```\nA --> B\n```\n\n```json\n{ "a": 1 }\n```\n');
check('fence-under-heading', 'Title: (none, PR body only)\nImpact: Users get X.\nMap:\n```\nA --> B\n```', node('headline.mjs', [cat(work, 'pr2.txt')]).out);
write(cat(work, 'pr3.txt'), '## Impact\n\nUsers get X.\n\n```json\n{ "a": 1 }\n```\n');
check('json-not-map', 'Title: (none, PR body only)\nImpact: Users get X.', node('headline.mjs', [cat(work, 'pr3.txt')]).out);

// indented block without an arrow or node is not a map
write(cat(work, 'ind.txt'), 'Subject\n\nImpact: Users get X.\n\n    just some indented prose\n    more prose\n');
check('indent-no-arrow', 'Title: Subject\nImpact: Users get X.', node('headline.mjs', [cat(work, 'ind.txt')]).out);

// free-form: no worst case, no risk
write(cat(work, 'free.txt'), 'Rename total field\n\nThe field is renamed. Clients break.\nSecond line of the paragraph.\n\nRisk: high\n');
check('free-form', 'Title: Rename total field\nImpact: The field is renamed.', node('headline.mjs', [cat(work, 'free.txt')]).out);

// prepare.mjs: arms.tsv append/replace, skill copy cleanup
const sk = cat(work, 'skill');
for (const d of [cat(sk, 'scripts'), cat(sk, 'references', '.omc'), cat(sk, 'evals'), cat(sk, '.omc')]) fs.mkdirSync(d, { recursive: true });
write(cat(sk, 'SKILL.md'), '# skill\n');
write(cat(sk, 'scripts', 'test.sh'), 'x\n');
write(cat(sk, 'scripts', 'test.mjs'), 'x\n');
write(cat(sk, 'scripts', 'facts.mjs'), 'x\n');
write(cat(sk, 'references', '.omc', 's'), 'x\n');
// lint stub that records its arguments; mentions --invariant so score.mjs passes the flag
write(
  cat(sk, 'scripts', 'lint.mjs'),
  "// supports --invariant\nimport fs from 'node:fs';\nfs.appendFileSync(process.env.LINT_LOG, process.argv.slice(2).map((a) => a + '|').join(''));\n",
);
const prun = cat(work, 'prun');
node('prepare.mjs', [prun, '--arm', 'a=none', '--cases', 'c9-proto-contract']);
node('prepare.mjs', [prun, '--arm', `b=${sk}`, '--cases', 'c9-proto-contract']);
if (node('prepare.mjs', [prun, '--arm', `b=${sk}`, '--cases', 'c9-proto-contract', '--runs', '2']).status === 0) {
  process.stdout.write('rerun-failed-expected\n');
  fails++;
}
check('arms-append', `a\tnone\nb\t${sk}`, fs.readFileSync(cat(prun, 'arms.tsv'), 'utf8').replace(/\n+$/, ''));
const cellSkill = cat(prun, 'b', 'c9-proto-contract', 'r1', 'skill');
check('skill-copy', 'SKILL.md references scripts', ls(cellSkill));
check('skill-no-test', 'facts.mjs lint.mjs', ls(cat(cellSkill, 'scripts')));
const omc = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.omc') omc.push(cat(d, e.name));
    else if (e.isDirectory()) walk(cat(d, e.name));
  }
};
walk(cellSkill);
check('skill-no-nested-omc', '', omc.join('\n'));
check(
  'prompt-facts',
  'yes',
  fs.readFileSync(cat(prun, 'b', 'c9-proto-contract', 'r1', 'prompt.md'), 'utf8').includes(`\`node ${cat(cellSkill, 'scripts', 'facts.mjs')} --base main --head feature --no-log\``) ? 'yes' : 'no',
);
// score.mjs passes the fixture's invariants to a lint that supports the flag
write(cat(prun, 'b', 'c9-proto-contract', 'r1', 'out.txt'), 'Title\n\nImpact: x.\n');
const lintlog = cat(work, 'lintlog');
node('score.mjs', [prun], { LINT_LOG: lintlog });
check('score-invariant', 'yes', fs.existsSync(lintlog) && fs.readFileSync(lintlog, 'utf8').includes('--invariant|proto field numbers are never reused|') ? 'yes' : 'no');

// layout: legacy r1, multiple runs, and sd across runs
const run = cat(work, 'run');
for (const d of [['a', 'c1-pr-trigger', 'r1'], ['a', 'c1-pr-trigger', 'r2'], ['b', 'c1-pr-trigger'], ['judge'], ['blind']]) {
  fs.mkdirSync(cat(run, ...d), { recursive: true });
}
for (const f of [['a', 'c1-pr-trigger', 'r1'], ['a', 'c1-pr-trigger', 'r2'], ['b', 'c1-pr-trigger']]) write(cat(run, ...f, 'out.txt'), 'Subject\n\nImpact: x.\n');
check(
  'cells',
  'a\tc1-pr-trigger\tr1\na\tc1-pr-trigger\tr2\nb\tc1-pr-trigger\tr1',
  node('cells.mjs', [run]).out.split('\n').map((l) => l.split('\t').slice(0, 3).join('\t')).join('\n'),
);
write(cat(run, 'b', 'c1-pr-trigger', 'out.txt'), 'Subject\n\n<!-- impact-recap:start -->\nImpact: x.\n');
node('blind.mjs', [run, 'c1-pr-trigger']);
const blindMd = fs.readFileSync(cat(run, 'blind', 'c1-pr-trigger.r1.md'), 'utf8').split('\n');
check('blind-normalizes', '1 0', `${blindMd.filter((l) => l.includes('so-what:start')).length} ${blindMd.filter((l) => l.includes('impact-recap')).length}`);
check(
  'blind-files',
  'c1-pr-trigger.r1.headline.md c1-pr-trigger.r1.key c1-pr-trigger.r1.md c1-pr-trigger.r2.headline.md c1-pr-trigger.r2.key c1-pr-trigger.r2.md',
  ls(cat(run, 'blind')),
);
for (const r of ['r1', 'r2']) {
  const rows = fs
    .readFileSync(cat(run, 'blind', `c1-pr-trigger.${r}.key`), 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => {
      const [label, arm] = l.split('\t');
      const s = arm === 'a' ? (r === 'r1' ? 5 : 3) : 4;
      return `${label}\t${s}\t${s}\t${s}\t${s}\t${s}\t4\tx\n`;
    });
  write(cat(run, 'judge', `c1-pr-trigger.${r}.tsv`), rows.join(''));
}
// arm a: run means 25 and 15, sd 7.07; arm b: one run, no sd
check(
  'sd',
  'a 20.00 7.07 2\nb 20.00 - 1',
  node('aggregate.mjs', [run])
    .out.split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f[0] === 'a' || f[0] === 'b')
    .map((f) => [f[0], f[f.length - 3], f[f.length - 2], f[f.length - 1]].join(' '))
    .join('\n'),
);

// judge validation: bad score, unknown label, missing row, CR endings
const good = cat(run, 'judge', 'c1-pr-trigger.r1.tsv');
const goodText = fs.readFileSync(good, 'utf8');
const goodLines = goodText.split('\n').filter((l) => l !== '');
let lastErr = '';
const tryAggregate = () => {
  const r = node('aggregate.mjs', [run]);
  lastErr = r.err;
  return r.status === 0 ? 'pass' : 'fail';
};
const withLines = (lines) => lines.map((l) => l + '\n').join('');
write(good, withLines(goodLines.map((l, i) => (i === 0 ? l.split('\t').map((f, k) => (k === 2 ? '7' : f)).join('\t') : l))));
check('bad-score', 'fail', tryAggregate());
write(good, withLines(goodLines.map((l, i) => (i === 0 ? l.replace(/^X[0-9]*/, 'X9') : l))));
check('bad-label', 'fail', tryAggregate());
write(good, withLines(goodLines.slice(1)));
check('missing-row', 'fail', tryAggregate());
check('error-names-file', 'yes', lastErr.includes('c1-pr-trigger.r1.tsv') ? 'yes' : 'no');
write(good, goodLines.map((l) => l + '\r\n').join(''));
check('crlf-ok', 'pass', tryAggregate());
write(good, goodText);

if (fails === 0) process.stdout.write('all passed\n');
process.exitCode = fails;
