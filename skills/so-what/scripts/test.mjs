#!/usr/bin/env node
// Runs every case against lint.mjs, facts.mjs, and upsert-pr.mjs.
// Runs on macOS, Linux, and Windows with Node >= 18 and git. No bash or awk.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'so-what-test-')));
// Windows can hold a file open briefly (EBUSY); a leftover temp dir is harmless.
process.on('exit', () => {
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  } catch { /* leave it */ }
});
let passed = 0;
let failed = 0;

// ---- helpers ---------------------------------------------------------------

const W = (name) => path.join(work, name);
const read = (f) => fs.readFileSync(f, 'utf8');
const write = (name, text) => fs.writeFileSync(W(name), text);
// Split text into lines the way awk does: a final newline does not add an empty line.
const lines = (text) => {
  const a = text.split('\n');
  if (a[a.length - 1] === '') a.pop();
  return a;
};
const unlines = (a) => a.map((l) => `${l}\n`).join('');
// Rewrite a file line by line; fn returns a string, an array of lines, or null to drop the line.
const transform = (src, dest, fn) => {
  const out = [];
  for (const l of lines(read(W(src)))) {
    const r = fn(l);
    if (r === null || r === undefined) continue;
    if (Array.isArray(r)) out.push(...r);
    else out.push(r);
  }
  write(dest, unlines(out));
};
const dropLines = (src, dest, re) => transform(src, dest, (l) => (re.test(l) ? null : l));
const sub = (src, dest, re, rep) => transform(src, dest, (l) => l.replace(re, rep));
const repeat = (word, n) => word.repeat(n);

function envWith(extra = {}, prependPath) {
  const env = { ...process.env, ...extra };
  if (prependPath) {
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
    env[key] = prependPath + path.delimiter + (env[key] || '');
  }
  return env;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  const out = (r.stdout || '') + (r.stderr || '') + (r.error ? `${r.error.message}\n` : '');
  return { ok: r.status === 0, out, stdout: r.stdout || '', status: r.status };
}
const node = (script, args, opts) => run(process.execPath, [path.join(here, script), ...args], opts);
const lint = (...args) => () => node('lint.mjs', args);
const lintWith = (opts, ...args) => () => node('lint.mjs', args, opts);

function expect(want, name, check) {
  let ok;
  let out = '';
  try {
    const r = check();
    if (typeof r === 'boolean') ok = r;
    else ({ ok, out } = r);
  } catch (e) {
    ok = false;
    out = `${e && e.stack ? e.stack : e}\n`;
  }
  const got = ok ? 'pass' : 'fail';
  if (got === want) {
    passed++;
  } else {
    failed++;
    process.stdout.write(`FAIL ${name}: expected ${want}, got ${got}\n`);
    for (const l of lines(out)) process.stdout.write(`    ${l}\n`);
  }
}

// grep -qx, grep -q, grep -c equivalents
const exists = (f) => fs.existsSync(f);
const hasLine = (f, s) => () => exists(f) && lines(read(f)).includes(s);
const hasMatch = (f, re) => () => exists(f) && lines(read(f)).some((l) => re.test(l));
const count = (f, s) => lines(read(f)).filter((l) => l.includes(s)).length;

// Stub executable: a Node script plus a launcher on PATH (gh.cmd on Windows, sh elsewhere).
function makeStub(dir, name, code) {
  fs.mkdirSync(dir, { recursive: true });
  const js = path.join(dir, `${name}-stub.mjs`);
  fs.writeFileSync(js, code);
  if (isWin) {
    fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${process.execPath}" "${js}" %*\r\n`);
  } else {
    const launcher = path.join(dir, name);
    fs.writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
    fs.chmodSync(launcher, 0o755);
  }
  return js;
}

function git(dir, ...args) {
  const r = run('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args]);
  if (!r.ok) throw new Error(`git ${args.join(' ')} failed in ${dir}:\n${r.out}`);
  return r;
}
function gitInit(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

// ---- fixtures --------------------------------------------------------------

write('commit-good', `ci(guardrails): run docs checks only on pull requests to main

Impact: Contributors get one docs-guardrails run per pull request;
direct pushes to branches start none.
Needs: Confirm the draft-PR check starts before merging.
Why: Pushes to feature branches ran the full docs gate twice, once on
push and once on the pull request, doubling CI minutes.
Risk: high - a misconfigured trigger would let unchecked docs merge;
verified by opening a draft PR and seeing the check run.
Rollback: revert

    [Contributor] --> [push to feature branch] --> (no docs run)
    [Contributor] --> [open PR into main]      --> (one docs run)
`);

write('commit-narration', `ci: update workflow

Impact: Updated docs-guardrails.yml to remove the push trigger line.
`);

write('commit-no-why', `feat(agents): teach agents to describe impact in commits

Impact: Agents now explain who notices a change and how it was verified.
`);

write('commit-low-risk', `docs: fix broken link to validation guide

Impact: Readers following the docs index reach the validation page.
`);

write('commit-underrated', `ci: drop weekly schedule from docs checks

Impact: Docs checks stop running on Mondays; pull requests still run them.
Why: The weekly run duplicated pull request checks with no new signal.
Risk: low - schedule only.
`);

write('commit-why-first', `fix(docs): restore the validation guide link

Why: The docs index pointed at a renamed page.
Impact: Readers following the docs index reach the validation page.
`);

write('subject-bad', 'Fix: The bug.\n');
write('subject-good', 'feat(skills): add so-what for commit and PR descriptions\n');

write('pr-good', `<!-- so-what:start -->
## Impact

Agents writing commits or pull requests in this repo now lead with the
consequence of a change: who notices, what behaves differently, and how it
was verified. Reviewers can judge risk without reconstructing it from the diff.

Worst case: reviewers merge guidance that hides a real risk.
Decision: none beyond normal review.

## Impact map

\`\`\`text
[Agent] --> [collect facts] --> [risk floor]
                                    |
                                    v
[Reviewer] <-- [impact-first text] -+
\`\`\`

<details>
<summary>Why, risk, verification</summary>

## Why

Descriptions restated the diff, so reviewers re-derived intent and risk.

## Risk: medium

| Area | Risk | What changes in behavior |
| ---- | ---- | ------------------------ |
| Agent instructions | medium | Agents follow the new description shape |

Only agent instructions change; no gate or CI behavior moves.

## Verification

- scripts/test.sh passes

</details>
<!-- so-what:end -->
`);

sub('pr-good', 'pr-underrated', /^## Risk: medium$/, '## Risk: low');
sub('pr-good', 'pr-mermaid-ascii-body', /^```text$/, '```mermaid');
dropLines('pr-good', 'pr-unterminated', /so-what:end/);
{
  let skip = false;
  transform('pr-good', 'pr-no-verification', (l) => {
    if (/^## Verification/.test(l)) skip = true;
    if (/^<\/details>/.test(l)) skip = false;
    return skip ? null : l;
  });
}
write('pr-diff-dump', `<!-- so-what:start -->
## Impact

Changed SKILL.md and lint.sh and facts.sh and areas.tsv and upsert-pr.sh and test.sh in the skill folder.

## Why

Needed.

## Risk: medium

Low.

## Verification

None yet.
<!-- so-what:end -->
`);

expect('pass', 'commit-good', lint('commit', W('commit-good'), '--risk', 'high'));
expect('fail', 'commit-narration', lint('commit', W('commit-narration')));
expect('fail', 'commit-missing-why-at-medium', lint('commit', W('commit-no-why'), '--risk', 'medium'));
expect('pass', 'commit-low-needs-impact-only', lint('commit', W('commit-low-risk'), '--risk', 'low'));
expect('fail', 'commit-risk-below-facts', lint('commit', W('commit-underrated'), '--risk', 'high'));
expect('fail', 'commit-why-before-impact', lint('commit', W('commit-why-first')));
expect('fail', 'subject-not-conventional', lint('subject', W('subject-bad')));
expect('pass', 'subject-conventional', lint('subject', W('subject-good')));
{
  const filler = repeat('Reviewers notice one more consequence here. ', 60);
  transform('pr-good', 'pr-too-long', (l) => (/^## Why/.test(l) ? [filler, '', l] : l));
}

expect('pass', 'pr-good', lint('pr', W('pr-good'), '--risk', 'medium'));
expect('fail', 'pr-over-word-limit', lint('pr', W('pr-too-long'), '--risk', 'medium'));
expect('fail', 'pr-risk-below-facts', lint('pr', W('pr-underrated'), '--risk', 'medium'));
expect('fail', 'pr-mermaid-with-ascii-body', lint('pr', W('pr-mermaid-ascii-body')));
expect('fail', 'pr-unterminated', lint('pr', W('pr-unterminated')));
expect('fail', 'pr-no-verification', lint('pr', W('pr-no-verification')));
expect('fail', 'pr-diff-dump', lint('pr', W('pr-diff-dump')));

// impact map rules
const mapCommit = (name, map) => write(name,
  'ci(trigger): run docs checks only on pull requests\n\nImpact: Contributors get one docs run per pull request, not two.\nNeeds: Confirm the draft-PR check starts.\nWhy: Pushes ran the gate twice.\nRisk: high - trigger change; verified with a draft PR.\nRollback: revert\n\n' + map);
mapCommit('commit-map-ok', `    [Contributor] --> [open PR into main] --> (one docs run)
    [Contributor] --> [push branch]       --> (no docs run)
`);
mapCommit('commit-map-box-ok', `    +-------------+      +------------------+
    | Contributor | ---> | one docs run     |
    +-------------+      +------------------+
`);
mapCommit('commit-map-unicode', `    [Contributor] ──▶ [open PR into main] ──▶ (one docs run)
    [Contributor] ──▶ [push branch]       ──▶ (no docs run)
`);
mapCommit('commit-map-misaligned', `    +-------------+      +------------------+
    | Contributor | ---> | one docs run      |
    +-------------+      +------------------+
`);
mapCommit('commit-map-no-arrow', `    [Contributor] [open PR into main] (one docs run)
    [Contributor] [push branch]       (no docs run)
`);
mapCommit('commit-map-one-node', `    docs run happens once per pull request now
    --> contributors wait less
    --> reviewers see fewer duplicate checks
`);
mapCommit('commit-map-too-wide', `    [Contributor] --> [open a pull request into the main branch of the repository] --> (one docs run)
    [Contributor] --> [push]
    [Contributor] --> [x]
`);
mapCommit('commit-map-file-name', `    [Contributor] --> [docs-guardrails.yml] --> (one docs run)
    [Contributor] --> [push branch]         --> (no docs run)
`);
mapCommit('commit-map-tab', `    [Contributor] --> [open PR]\t--> (one docs run)
    [Contributor] --> [push branch] --> (no docs run)
`);
mapCommit('commit-map-too-short', `    [Contributor] --> (one docs run)
`);
expect('pass', 'commit-map-ok', lint('commit', W('commit-map-ok'), '--risk', 'high'));
expect('pass', 'commit-map-box-ok', lint('commit', W('commit-map-box-ok'), '--risk', 'high'));
expect('fail', 'commit-map-unicode', lint('commit', W('commit-map-unicode'), '--risk', 'high'));
expect('fail', 'commit-map-misaligned', lint('commit', W('commit-map-misaligned'), '--risk', 'high'));
expect('fail', 'commit-map-no-arrow', lint('commit', W('commit-map-no-arrow'), '--risk', 'high'));
expect('fail', 'commit-map-one-node', lint('commit', W('commit-map-one-node'), '--risk', 'high'));
expect('fail', 'commit-map-too-wide', lint('commit', W('commit-map-too-wide'), '--risk', 'high'));
expect('fail', 'commit-map-file-name', lint('commit', W('commit-map-file-name'), '--risk', 'high'));
expect('fail', 'commit-map-tab', lint('commit', W('commit-map-tab'), '--risk', 'high'));
expect('fail', 'commit-map-too-short', lint('commit', W('commit-map-too-short'), '--risk', 'high'));
dropLines('commit-map-ok', 'commit-map-missing', /^    /);
expect('fail', 'commit-map-required-at-high', lint('commit', W('commit-map-missing'), '--risk', 'high'));
expect('pass', 'commit-map-optional-at-low', lint('commit', W('commit-low-risk'), '--risk', 'low'));
write('commit-map-two', `${read(W('commit-map-ok'))}\n    [Extra] --> [second map] --> (nope)\n`);
expect('fail', 'commit-map-only-one', lint('commit', W('commit-map-two'), '--risk', 'high'));
{
  let skip = false;
  transform('pr-good', 'pr-no-map', (l) => {
    if (/^## Impact map/.test(l)) skip = true;
    if (/^<details>/.test(l)) skip = false;
    return skip ? null : l;
  });
}
expect('fail', 'pr-map-required-at-medium', lint('pr', W('pr-no-map'), '--risk', 'medium'));
expect('pass', 'pr-map-optional-at-low', lint('pr', W('pr-no-map'), '--risk', 'low'));
transform('pr-good', 'pr-map-unbalanced', (l) =>
  (l === '[Agent] --> [collect facts] --> [risk floor]' ? '[Agent] --> [collect facts] --> [risk floor' : l));
expect('fail', 'pr-map-unbalanced-bracket', lint('pr', W('pr-map-unbalanced'), '--risk', 'medium'));
{
  let mode = '';
  const map = [];
  transform('pr-good', 'pr-map-misplaced', (l) => {
    if (/^## Impact map/.test(l)) mode = 'map';
    if (/^<details>/.test(l)) mode = '';
    if (mode === 'map') { map.push(l); return null; }
    if (/^## Verification/.test(l)) return [...map, l];
    return l;
  });
}
expect('fail', 'pr-map-must-follow-impact', lint('pr', W('pr-map-misplaced'), '--risk', 'medium'));

// brevity limits
{
  const longSentence = repeat('word ', 35);
  write('commit-impact-too-long', `docs(guide): restore the validation guide link\n\nImpact: Readers following the index reach the page. ${longSentence}\n`);
  write('commit-lead-too-long', `docs(guide): restore the validation guide link\n\nImpact: ${longSentence}.\n`);
}
expect('fail', 'commit-impact-over-45-words', lint('commit', W('commit-impact-too-long')));
expect('fail', 'commit-lead-sentence-over-30-words', lint('commit', W('commit-lead-too-long')));
{
  const filler = repeat('Reviewers notice one more consequence here. ', 10);
  const src = lines(read(W('pr-good')));
  const out = [];
  for (let i = 0; i < src.length; i++) {
    out.push(src[i]);
    if (src[i] === '## Impact') {
      if (i + 1 < src.length) out.push(src[++i]);
      out.push(filler);
    }
  }
  write('pr-impact-too-long', unlines(out));
}
expect('fail', 'pr-impact-over-70-words', lint('pr', W('pr-impact-too-long'), '--risk', 'medium'));

const upsert = (args, opts) => node('upsert-pr.mjs', args, opts);
write('body-plain', 'Hand-written intro.\n\n');
write('merged-once', upsert(['--merge', W('body-plain'), W('pr-good')]).stdout);
write('body-with-tail', `${read(W('merged-once'))}\nSummary by CodeRabbit\n`);
sub('pr-good', 'pr-revised', /Only agent instructions change/, 'Agent instructions change');
write('merged-twice', upsert(['--merge', W('body-with-tail'), W('pr-revised')]).stdout);

expect('pass', 'upsert-keeps-intro', hasLine(W('merged-once'), 'Hand-written intro.'));
expect('pass', 'upsert-appends-block', hasLine(W('merged-once'), '<!-- so-what:end -->'));
expect('pass', 'upsert-replaces-block', hasMatch(W('merged-twice'), /^Agent instructions change/));
expect('fail', 'upsert-drops-old-block', hasMatch(W('merged-twice'), /^Only agent instructions change/));
expect('pass', 'upsert-keeps-tail', hasLine(W('merged-twice'), 'Summary by CodeRabbit'));
expect('pass', 'upsert-single-block', () => count(W('merged-twice'), 'so-what:start') === 1);

const repo = W('repo');
gitInit(repo);
const factsInRepo = (...args) => node('facts.mjs', args, { cwd: repo });
git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
fs.writeFileSync(path.join(repo, '.github', 'workflows', 'check.yml'), 'on: pull_request\n');
git(repo, 'add', '.github');
git(repo, 'commit', '-q', '-m', 'ci');

write('facts', factsInRepo('--base', 'HEAD~1', '--head', 'HEAD').stdout);
expect('pass', 'facts-rates-ci-high', hasMatch(W('facts'), /^risk: high \(driven by ci\)/));
expect('fail', 'facts-empty-scope', () => factsInRepo('--base', 'HEAD', '--head', 'HEAD'));
fs.writeFileSync(path.join(repo, 'notes.md'), 'draft\n');
git(repo, 'add', 'notes.md');
write('facts-staged', factsInRepo('--staged').stdout);
expect('pass', 'facts-staged-rates-docs-low', hasMatch(W('facts-staged'), /^risk: low \(driven by docs\)/));

write('commit-risk-before-why', `fix(docs): restore the validation guide link

Impact: Readers following the docs index reach the validation page.
Risk: low - one link target.
Why: The docs index pointed at a renamed page.
`);
expect('fail', 'commit-why-after-risk', lint('commit', W('commit-risk-before-why')));
expect('fail', 'facts-staged-with-range', () => node('facts.mjs', ['--staged', '--base', 'HEAD']));

dropLines('pr-good', 'pr-no-risk-row', /^\| Agent instructions/);
transform('pr-good', 'pr-no-risk-header', (l) => {
  if (/^\| Area/.test(l)) return null;
  if (/^\| Agent instructions/.test(l)) return [l, l];
  return l;
});
sub('pr-good', 'pr-one-cell-risk-row', /^\| Agent instructions.*$/, '| unspecified |');
sub('pr-good', 'pr-empty-risk-area', /^\| Agent instructions.*$/, '|   | medium | Agents follow the new description shape |');
sub('pr-good', 'pr-empty-risk-level', /^\| Agent instructions.*$/, '| Agent instructions |   | Agents follow the new description shape |');
sub('pr-good', 'pr-empty-risk-consequence', /^\| Agent instructions.*$/, '| Agent instructions | medium |   |');
sub('pr-good', 'pr-no-verification-item', /^- scripts\/test\.sh passes$/, 'scripts/test.sh passes');
expect('fail', 'pr-risk-without-area-row', lint('pr', W('pr-no-risk-row')));
expect('fail', 'pr-risk-without-header', lint('pr', W('pr-no-risk-header')));
expect('fail', 'pr-one-cell-risk-row', lint('pr', W('pr-one-cell-risk-row')));
expect('fail', 'pr-empty-risk-area', lint('pr', W('pr-empty-risk-area')));
expect('fail', 'pr-empty-risk-level', lint('pr', W('pr-empty-risk-level')));
expect('fail', 'pr-empty-risk-consequence', lint('pr', W('pr-empty-risk-consequence')));
expect('fail', 'pr-verification-without-item', lint('pr', W('pr-no-verification-item')));

const writeCommit = (name, impact) => write(name, `docs(guide): restore the validation guide link\n\nImpact: ${impact}\n`);
writeCommit('commit-editors', 'Editors of the docs index reach the validation page again.');
writeCommit('commit-replaced', 'Replaced the trigger so contributors get one check per PR.');
writeCommit('commit-node', 'Contributors on Node.js 20 run the docs gate without errors.');
writeCommit('commit-requirements', 'Contributors installing requirements.txt get the pinned linter.');
write('commit-note-continuation', 'docs(guide): restore the validation guide link\n\nImpact: Readers following the index reach\nNote: the validation page again after the rename.\n');

expect('pass', 'commit-noun-opener-is-not-edit-verb', lint('commit', W('commit-editors')));
expect('fail', 'commit-replaced-opener', lint('commit', W('commit-replaced')));
expect('pass', 'commit-framework-name-is-not-file', lint('commit', W('commit-node')));
expect('fail', 'commit-txt-file-named', lint('commit', W('commit-requirements')));
expect('pass', 'commit-colon-continuation', lint('commit', W('commit-note-continuation')));

{
  let mode = '';
  const why = [];
  const risk = [];
  transform('pr-good', 'pr-out-of-order', (l) => {
    if (/^## Why/.test(l)) mode = 'why';
    if (/^## Risk/.test(l)) mode = 'risk';
    if (/^## Verification/.test(l)) mode = '';
    if (mode === 'why') { why.push(l); return null; }
    if (mode === 'risk') { risk.push(l); return null; }
    if (/^## Verification/.test(l)) return [...risk, ...why, l];
    return l;
  });
}
transform('pr-good', 'pr-heading-in-code', (l) => (/^## Verification/.test(l)
  ? ['## Before / after', '', '```markdown', '## Not a section', '```', '', l] : l));
expect('fail', 'pr-sections-out-of-order', lint('pr', W('pr-out-of-order')));
expect('pass', 'pr-heading-inside-code-fence', lint('pr', W('pr-heading-in-code'), '--risk', 'medium'));

write('body-crlf', 'intro\r\n<!-- so-what:start -->\r\nOLD\r\n<!-- so-what:end -->\r\nfooter\r\n');
write('merged-crlf', upsert(['--merge', W('body-crlf'), W('pr-good')]).stdout);
expect('fail', 'upsert-crlf-drops-old-block', hasLine(W('merged-crlf'), 'OLD'));
expect('pass', 'upsert-crlf-single-block', () => count(W('merged-crlf'), 'so-what:start') === 1);
expect('pass', 'upsert-crlf-keeps-footer', hasLine(W('merged-crlf'), 'footer'));

write('body-unclosed', 'a\n<!-- so-what:start -->\nuser text\n');
write('body-reversed', '<!-- so-what:end -->\ny\n<!-- so-what:start -->\nz\n');
write('body-two-blocks', read(W('merged-once')) + read(W('pr-good')));
expect('fail', 'upsert-refuses-unclosed', () => upsert(['--merge', W('body-unclosed'), W('pr-good')]));
expect('fail', 'upsert-refuses-reversed', () => upsert(['--merge', W('body-reversed'), W('pr-good')]));
expect('fail', 'upsert-refuses-two-blocks', () => upsert(['--merge', W('body-two-blocks'), W('pr-good')]));
expect('fail', 'upsert-refuses-missing-block', () => upsert(['--merge', W('body-plain'), W('missing')]));

const mapped = W('mapped');
gitInit(mapped);
git(mapped, 'commit', '-q', '--allow-empty', '-m', 'base');
function areaOf(rel) {
  const file = path.join(mapped, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x\n');
  git(mapped, 'add', '-A');
  git(mapped, 'commit', '-q', '-m', rel);
  const out = lines(node('facts.mjs', ['--base', 'HEAD~1', '--head', 'HEAD', '--no-log'], { cwd: mapped }).stdout);
  const i = out.findIndex((l) => /^changes:/.test(l));
  if (i < 0 || i + 1 >= out.length) return '';
  const f = out[i + 1].trim().split(/\s+/);
  return `${f[1] ?? ''} ${f[2] ?? ''}`;
}
const area = (rel, want) => () => {
  const got = areaOf(rel);
  return { ok: got === want, out: `area of ${rel}: got '${got}', want '${want}'\n` };
};
expect('pass', 'areas-ci-high', area('.github/workflows/ci.yml', 'ci high'));
expect('pass', 'areas-migration-high', area('db/migrations/001_init.sql', 'data high'));
expect('pass', 'areas-manifest-medium', area('package.json', 'deps medium'));
expect('pass', 'areas-tests-low', area('src/foo.test.ts', 'tests low'));
expect('pass', 'areas-docs-low', area('README.md', 'docs low'));
expect('pass', 'areas-source-fallback', area('src/app.ts', 'source medium'));

// decision line
dropLines('pr-good', 'pr-no-decision', /^Decision:/);
sub('pr-no-decision', 'pr-low-no-decision', /^## Risk: medium$/, '## Risk: low');
sub('pr-good', 'pr-decision-26-words', /^Decision: .*$/, `Decision: ${repeat('go ', 26)}`);
sub('pr-good', 'pr-decision-25-words', /^Decision: .*$/, `Decision: ${repeat('go ', 25)}`);
sub('pr-good', 'pr-decision-empty', /^Decision: .*$/, 'Decision:');
{
  const filler = repeat('Reviewers notice one more consequence. ', 6);
  transform('pr-decision-25-words', 'pr-decision-uncounted', (l) => (/^Worst case:/.test(l) ? [filler, '', l] : l));
}
expect('pass', 'pr-decision-present-at-medium', lint('pr', W('pr-good'), '--risk', 'medium'));
expect('fail', 'pr-decision-required-at-medium', lint('pr', W('pr-no-decision'), '--risk', 'medium'));
expect('fail', 'pr-decision-required-by-declared-level', lint('pr', W('pr-no-decision')));
expect('pass', 'pr-decision-optional-at-low', lint('pr', W('pr-low-no-decision'), '--risk', 'low'));
expect('fail', 'pr-decision-over-25-words', lint('pr', W('pr-decision-26-words'), '--risk', 'medium'));
expect('pass', 'pr-decision-at-25-words', lint('pr', W('pr-decision-25-words'), '--risk', 'medium'));
expect('fail', 'pr-decision-empty', lint('pr', W('pr-decision-empty'), '--risk', 'medium'));
expect('pass', 'pr-decision-not-in-impact-word-count', lint('pr', W('pr-decision-uncounted'), '--risk', 'medium'));

// needs label (commit)
write('commit-needs', 'docs(guide): restore the validation guide link\n\nImpact: Readers following the index reach the validation page again.\nNeeds: Confirm the link target before release.\n');
write('commit-needs-long', `docs(guide): restore the validation guide link\n\nImpact: Readers following the index reach the validation page again.\nNeeds: ${repeat('go ', 26)}\n`);
write('commit-needs-first', 'docs(guide): restore the validation guide link\n\nNeeds: Confirm the link.\nImpact: Readers following the index reach the validation page again.\n');
expect('pass', 'commit-needs-label', lint('commit', W('commit-needs'), '--risk', 'low'));
expect('fail', 'commit-needs-over-25-words', lint('commit', W('commit-needs-long'), '--risk', 'low'));
expect('fail', 'commit-needs-before-impact', lint('commit', W('commit-needs-first'), '--risk', 'low'));

// rollback at high risk
function rollbackCommit(name, rollback) {
  let text = 'ci(trigger): run docs checks only on pull requests\n\nImpact: Contributors get one docs run per pull request, not two.\nNeeds: Confirm the draft-PR check starts.\nWhy: Pushes ran the gate twice.\nRisk: high - trigger change; verified with a draft PR.\n';
  if (rollback) text += `Rollback: ${rollback}\n`;
  text += '\n    [Contributor] --> [open PR into main] --> (one docs run)\n    [Contributor] --> [push branch]       --> (no docs run)\n';
  write(name, text);
}
rollbackCommit('commit-rollback-none');
rollbackCommit('commit-rollback-revert', 'revert');
rollbackCommit('commit-rollback-extra', 'revert + rerun the backfill job');
rollbackCommit('commit-rollback-irreversible', 'irreversible: phone numbers in the dropped column');
rollbackCommit('commit-rollback-bad', 'undo it by hand');
rollbackCommit('commit-rollback-bare-plus', 'revert +');
expect('fail', 'commit-rollback-required-at-high', lint('commit', W('commit-rollback-none'), '--risk', 'high'));
expect('pass', 'commit-rollback-revert', lint('commit', W('commit-rollback-revert'), '--risk', 'high'));
expect('pass', 'commit-rollback-revert-plus-step', lint('commit', W('commit-rollback-extra'), '--risk', 'high'));
expect('pass', 'commit-rollback-irreversible', lint('commit', W('commit-rollback-irreversible'), '--risk', 'high'));
expect('fail', 'commit-rollback-bad-form', lint('commit', W('commit-rollback-bad'), '--risk', 'high'));
expect('fail', 'commit-rollback-revert-plus-nothing', lint('commit', W('commit-rollback-bare-plus'), '--risk', 'high'));
transform('commit-rollback-revert', 'commit-rollback-before-risk', (l) => {
  if (/^Rollback:/.test(l)) return null;
  if (/^Risk:/.test(l)) return ['Rollback: revert', l];
  return l;
});
expect('fail', 'commit-rollback-before-risk', lint('commit', W('commit-rollback-before-risk'), '--risk', 'high'));
sub('commit-rollback-none', 'commit-medium-no-rollback', /^Risk: high.*$/, 'Risk: medium - trigger change; verified with a draft PR.');
expect('pass', 'commit-rollback-not-needed-at-medium', lint('commit', W('commit-medium-no-rollback'), '--risk', 'medium'));

function prHigh(name, rollback) {
  transform('pr-good', name, (l) => {
    if (l === '## Risk: medium') return '## Risk: high';
    if (/^Decision:/.test(l)) return 'Decision: approve the new description shape before merge.';
    if (/^\| Agent instructions/.test(l)) l = l.replace('| medium |', '| high |');
    if (/^Only agent instructions change/.test(l) && rollback) return [l, '', `Rollback: ${rollback}`];
    return l;
  });
}
prHigh('pr-high-none');
prHigh('pr-high-revert', 'revert');
prHigh('pr-high-extra', 'revert + clear the CDN cache');
prHigh('pr-high-irreversible', 'irreversible: the dropped column data');
prHigh('pr-high-bad', 'maybe revert');
expect('fail', 'pr-rollback-required-at-high', lint('pr', W('pr-high-none'), '--risk', 'high'));
expect('pass', 'pr-rollback-revert', lint('pr', W('pr-high-revert'), '--risk', 'high'));
expect('pass', 'pr-rollback-revert-plus-step', lint('pr', W('pr-high-extra'), '--risk', 'high'));
expect('pass', 'pr-rollback-irreversible', lint('pr', W('pr-high-irreversible'), '--risk', 'high'));
expect('fail', 'pr-rollback-bad-form', lint('pr', W('pr-high-bad'), '--risk', 'high'));
expect('pass', 'pr-rollback-not-needed-at-medium', lint('pr', W('pr-good'), '--risk', 'medium'));
dropLines('pr-high-revert', 'pr-high-revert-no-decision', /^Decision:/);
expect('fail', 'pr-high-needs-decision', lint('pr', W('pr-high-revert-no-decision'), '--risk', 'high'));

// not verified needs an owner at high risk
const addItem = (src, dest, item) => {
  const out = [];
  for (const l of lines(read(src))) {
    out.push(l);
    if (l === '- scripts/test.sh passes') out.push(item);
  }
  write(dest, unlines(out));
};
addItem(W('pr-high-revert'), 'pr-high-nv-no-owner', '- Not verified: the staging deploy.');
addItem(W('pr-high-revert'), 'pr-high-nv-owner', '- Not verified: the staging deploy. owner: Dana, before merge.');
addItem(W('pr-high-revert'), 'pr-high-nv-upper', '- NOT VERIFIED: the staging deploy.');
addItem(W('pr-high-revert'), 'pr-high-nv-wrapped', '- Not verified: the staging deploy,\n  which needs a release window. Owner: Dana.');
addItem(W('pr-good'), 'pr-medium-nv-no-owner', '- Not verified: the staging deploy.');
expect('fail', 'pr-not-verified-needs-owner-at-high', lint('pr', W('pr-high-nv-no-owner'), '--risk', 'high'));
expect('pass', 'pr-not-verified-with-owner', lint('pr', W('pr-high-nv-owner'), '--risk', 'high'));
expect('fail', 'pr-not-verified-case-insensitive', lint('pr', W('pr-high-nv-upper'), '--risk', 'high'));
expect('pass', 'pr-not-verified-owner-on-wrapped-line', lint('pr', W('pr-high-nv-wrapped'), '--risk', 'high'));
expect('pass', 'pr-not-verified-no-owner-ok-at-medium', lint('pr', W('pr-medium-nv-no-owner'), '--risk', 'medium'));
sub('commit-rollback-revert', 'commit-nv-no-owner', /^Risk: high - trigger change; verified with a draft PR\./, 'Risk: high - trigger change; not verified.');
sub('commit-rollback-revert', 'commit-nv-owner', /^Risk: high - trigger change; verified with a draft PR\./, 'Risk: high - trigger change; Not Verified, owner: Dana.');
expect('fail', 'commit-not-verified-needs-owner-at-high', lint('commit', W('commit-nv-no-owner'), '--risk', 'high'));
expect('pass', 'commit-not-verified-with-owner', lint('commit', W('commit-nv-owner'), '--risk', 'high'));

// details fold
dropLines('pr-good', 'pr-no-details', /^(<details>|<summary>|<\/details>)/);
dropLines('pr-good', 'pr-details-unclosed', /^<\/details>/);
dropLines('pr-good', 'pr-details-unopened', /^<details>/);
{
  const out = [];
  for (const l of lines(read(W('pr-good')))) {
    if (out.length > 0 && out[out.length - 1] === '' && /^<\/details>/.test(l)) out.pop();
    out.push(l);
  }
  write('pr-details-no-blank', unlines(out));
}
{
  const src = lines(read(W('pr-good')));
  const out = [];
  for (let i = 0; i < src.length; i++) {
    out.push(src[i]);
    if (/^<summary>/.test(src[i])) i++;
  }
  write('pr-summary-no-blank', unlines(out));
}
{
  let held = false;
  transform('pr-good', 'pr-all-visible', (l) => {
    if (/^<details>/.test(l)) { held = true; return null; }
    if (held && /^<summary>/.test(l)) return null;
    if (/^<\/details>/.test(l)) return null;
    return l;
  });
}
expect('fail', 'pr-details-required', lint('pr', W('pr-no-details'), '--risk', 'medium'));
expect('fail', 'pr-details-unclosed', lint('pr', W('pr-details-unclosed'), '--risk', 'medium'));
expect('fail', 'pr-details-unopened', lint('pr', W('pr-details-unopened'), '--risk', 'medium'));
expect('fail', 'pr-details-blank-before-close', lint('pr', W('pr-details-no-blank'), '--risk', 'medium'));
expect('fail', 'pr-details-blank-after-summary', lint('pr', W('pr-summary-no-blank'), '--risk', 'medium'));
expect('fail', 'pr-sections-must-be-inside-details', lint('pr', W('pr-all-visible'), '--risk', 'medium'));
// the 200-word prose limit excludes HTML tag lines
{
  const filler = repeat('word ', 120);
  const afterWhy = (src, dest, extra) => {
    const a = lines(read(W(src)));
    const out = [];
    for (let i = 0; i < a.length; i++) {
      out.push(a[i]);
      if (/^## Why/.test(a[i])) {
        if (i + 1 < a.length) out.push(a[++i]);
        out.push(...extra);
      }
    }
    write(dest, unlines(out));
  };
  afterWhy('pr-good', 'pr-prose-near-limit', [filler]);
  const long = repeat('tag ', 90);
  transform('pr-prose-near-limit', 'pr-prose-big-summary', (l) =>
    (/^<summary>/.test(l) ? `<summary>Why, risk, verification ${long}</summary>` : l));
  afterWhy('pr-good', 'pr-prose-over', [filler, '', filler]);
}
expect('pass', 'pr-prose-near-limit', lint('pr', W('pr-prose-near-limit'), '--risk', 'medium'));
expect('pass', 'pr-html-tag-lines-not-counted', lint('pr', W('pr-prose-big-summary'), '--risk', 'medium'));
expect('fail', 'pr-prose-over-200', lint('pr', W('pr-prose-over'), '--risk', 'medium'));

// invariants
write('invariants.tsv', '# example\n^notes\\.md$\tdraft notes stay private\tdocs-team\n\n^notes\\.\tdraft notes stay private\tdocs-team\n^src/never/\tnever matched\tnobody\n');
write('facts-inv', node('facts.mjs', ['--staged'], { cwd: repo, env: envWith({ SO_WHAT_INVARIANTS: W('invariants.tsv') }) }).stdout);
expect('pass', 'facts-lists-touched-invariant', hasLine(W('facts-inv'), '  invariant: draft notes stay private (owner: docs-team)'));
expect('pass', 'facts-lists-invariant-once', () => count(W('facts-inv'), 'invariant: ') === 1);
expect('pass', 'facts-skips-untouched-invariant', () => count(W('facts-inv'), 'never matched') === 0);
expect('pass', 'facts-invariant-raises-floor-to-medium', hasMatch(W('facts-inv'), /^risk: medium/));
expect('fail', 'facts-prints-no-invariants-without-file', hasMatch(W('facts-staged'), /invariant/));
fs.mkdirSync(path.join(repo, '.so-what'), { recursive: true });
fs.writeFileSync(path.join(repo, '.so-what', 'invariants.tsv'), '^notes\\.md$\trepo-level invariant\tsteward\n');
write('facts-inv-repo', factsInRepo('--staged').stdout);
expect('pass', 'facts-reads-repo-invariants-file', hasMatch(W('facts-inv-repo'), /invariant: repo-level invariant \(owner: steward\)/));
fs.rmSync(path.join(repo, '.so-what'), { recursive: true, force: true });
expect('pass', 'lint-invariant-named-in-pr-risk', lint('pr', W('pr-good'), '--risk', 'medium', '--invariant', 'agent instructions'));
expect('fail', 'lint-invariant-missing-in-pr-risk', lint('pr', W('pr-good'), '--risk', 'medium', '--invariant', 'billing ledger'));
expect('fail', 'lint-invariant-repeatable', lint('pr', W('pr-good'), '--risk', 'medium', '--invariant', 'agent instructions', '--invariant', 'billing ledger'));
expect('pass', 'lint-invariant-named-in-commit-risk', lint('commit', W('commit-rollback-revert'), '--risk', 'high', '--invariant', 'draft PR'));
expect('fail', 'lint-invariant-missing-in-commit', lint('commit', W('commit-rollback-revert'), '--risk', 'high', '--invariant', 'billing ledger'));
expect('pass', 'lint-invariant-in-commit-rollback-line', lint('commit', W('commit-rollback-extra'), '--risk', 'high', '--invariant', 'backfill job'));

// new risk-map rows (order matters: tests and docs win over security)
expect('pass', 'areas-security-before-tests', area('tests/auth/x.test.js', 'security high'));
expect('pass', 'areas-security-before-docs', area('docs/security.md', 'security high'));
expect('pass', 'areas-spec-dir-contract-is-interface', area('spec/openapi.yaml', 'interface high'));
expect('pass', 'areas-spec-dir-tests-low', area('spec/helpers/util.js', 'tests low'));
expect('pass', 'areas-security-high', area('src/auth.js', 'security high'));
expect('pass', 'areas-security-dir-high', area('src/permissions/check.py', 'security high'));
expect('pass', 'areas-authors-is-not-security', area('src/authors.js', 'source medium'));
expect('pass', 'areas-interface-openapi-high', area('api/openapi.yaml', 'interface high'));
expect('pass', 'areas-interface-proto-high', area('api/user.proto', 'interface high'));
expect('pass', 'areas-flags-high', area('config/flags.json', 'flags high'));
expect('pass', 'areas-data-sql-high', area('db/schema.sql', 'data high'));
expect('pass', 'areas-data-prisma-high', area('prisma/schema.prisma', 'data high'));
expect('pass', 'areas-infra-terraform-high', area('infra/main.tf', 'infra high'));
expect('pass', 'areas-agents-medium', area('.claude/settings.json', 'agents medium'));

// plan kind
write('plan-good', `<!-- so-what:start -->
## Plan

Contributors will see one docs-guardrails run per pull request, and
pushes to feature branches will start none. The expected worst case is a
wrong trigger letting unchecked docs reach main.

## Risk: high

Only the CI trigger changes; no data or interface moves.

## Verification plan

- Open a draft PR into main and watch the docs check start once.
- Push to a feature branch and confirm no docs run starts.
<!-- so-what:end -->
`);
{
  let skip = false;
  transform('plan-good', 'plan-no-verification', (l) => {
    if (/^## Verification plan/.test(l)) skip = true;
    if (/so-what:end/.test(l)) skip = false;
    return skip ? null : l;
  });
}
dropLines('plan-good', 'plan-no-items', /^- /);
{
  let skip = false;
  transform('plan-good', 'plan-no-risk', (l) => {
    if (/^## Risk/.test(l)) skip = true;
    if (/^## Verification plan/.test(l)) skip = false;
    return skip ? null : l;
  });
}
sub('plan-good', 'plan-bad-risk', /^## Risk: high$/, '## Risk: severe');
{
  const a = lines(read(W('plan-good')));
  const out = [];
  let skip = false;
  for (let i = 0; i < a.length; i++) {
    const l = a[i];
    if (l === '## Plan') {
      out.push(l);
      if (i + 1 < a.length) out.push(a[++i]);
      out.push('Short plan only.');
      skip = true;
      continue;
    }
    if (skip && /^## Risk/.test(l)) { skip = false; out.push(''); }
    if (!skip) out.push(l);
  }
  write('plan-too-short', unlines(out));
}
sub('plan-good', 'plan-edit-opener', /^Contributors will see/, 'Updated the trigger so contributors will see');
transform('plan-good', 'plan-with-map', (l) => (/^## Risk/.test(l)
  ? ['## Impact map', '', '```text', '[Contributor] --> [open PR] --> (one docs run)', '[Contributor] --> [push]    --> (no docs run)', '```', '', l] : l));
transform('plan-good', 'plan-wrong-heading', (l) => (/^## Verification plan/.test(l) ? '## Verification' : l));
expect('pass', 'plan-good', lint('plan', W('plan-good'), '--risk', 'high'));
expect('fail', 'plan-missing-verification-plan', lint('plan', W('plan-no-verification')));
expect('fail', 'plan-verification-needs-item', lint('plan', W('plan-no-items')));
expect('fail', 'plan-missing-risk', lint('plan', W('plan-no-risk')));
expect('fail', 'plan-bad-risk-level', lint('plan', W('plan-bad-risk')));
expect('fail', 'plan-under-20-words', lint('plan', W('plan-too-short')));
expect('fail', 'plan-edit-verb-opener', lint('plan', W('plan-edit-opener')));
expect('pass', 'plan-optional-impact-map', lint('plan', W('plan-with-map')));
expect('fail', 'plan-wrong-verification-heading', lint('plan', W('plan-wrong-heading')));
expect('fail', 'plan-is-not-a-pr', lint('pr', W('plan-good')));
expect('fail', 'pr-is-not-a-plan', lint('plan', W('pr-good')));
sub('plan-good', 'plan-below-floor', /^## Risk: high$/, '## Risk: medium');
expect('fail', 'plan-risk-below-floor', lint('plan', W('plan-below-floor'), '--risk', 'high'));

// upsert --show and --kind plan (gh stubbed through SO_WHAT_GH and a PATH launcher)
const ghStub = makeStub(W('bin'), 'gh', `import fs from 'node:fs';
const a = process.argv.slice(2);
if (a[0] === 'pr' && a[1] === 'view') process.stdout.write(fs.readFileSync(process.env.GH_BODY));
process.exit(0);
`);
const upsertWithBody = (body, ...args) =>
  upsert(args, { env: envWith({ GH_BODY: body, SO_WHAT_GH: ghStub }, W('bin')) });
write('body-with-plan', `Intro.\n\n${read(W('plan-good'))}\nFooter.\n`);
write('shown', upsertWithBody(W('body-with-plan'), '7', '--show').stdout);
expect('pass', 'upsert-show-prints-block', () => read(W('shown')) === read(W('plan-good')));
write('shown-none', upsertWithBody(W('body-plain'), '7', '--show').stdout);
expect('pass', 'upsert-show-empty-without-block', () => fs.statSync(W('shown-none')).size === 0);
expect('fail', 'upsert-show-refuses-malformed', () => upsertWithBody(W('body-unclosed'), '7', '--show'));
write('replaced', upsertWithBody(W('body-with-plan'), '7', W('pr-good'), '--risk', 'medium', '--dry-run').stdout);
expect('pass', 'upsert-recap-replaces-plan-block', hasMatch(W('replaced'), /^## Impact$/));
expect('fail', 'upsert-recap-drops-plan-heading', hasMatch(W('replaced'), /^## Plan$/));
expect('pass', 'upsert-recap-keeps-footer', hasLine(W('replaced'), 'Footer.'));
write('plan-merged', upsertWithBody(W('body-plain'), '7', W('plan-good'), '--kind', 'plan', '--risk', 'none', '--dry-run').stdout);
expect('pass', 'upsert-kind-plan-dry-run', hasMatch(W('plan-merged'), /^## Verification plan$/));
expect('fail', 'upsert-default-kind-rejects-plan', () => upsertWithBody(W('body-plain'), '7', W('plan-good'), '--risk', 'none', '--dry-run'));
expect('fail', 'upsert-kind-plan-rejects-pr', () => upsertWithBody(W('body-plain'), '7', W('pr-good'), '--kind', 'plan', '--risk', 'none', '--dry-run'));
expect('fail', 'upsert-rejects-unknown-kind', () => upsertWithBody(W('body-plain'), '7', W('pr-good'), '--kind', 'recap', '--risk', 'none', '--dry-run'));
expect('fail', 'upsert-passes-invariant-to-lint', () => upsertWithBody(W('body-plain'), '7', W('pr-good'), '--risk', 'medium', '--invariant', 'billing ledger', '--dry-run'));
expect('pass', 'upsert-invariant-satisfied', () => upsertWithBody(W('body-plain'), '7', W('pr-good'), '--risk', 'medium', '--invariant', 'agent instructions', '--dry-run'));
expect('fail', 'upsert-requires-risk', () => upsertWithBody(W('body-plain'), '7', W('pr-good'), '--dry-run'));

// mermaid impact maps (pull requests only)
function prWithMap(name, fence, map) {
  let skip = false;
  transform('pr-good', name, (l) => {
    if (l === '```text') { skip = true; return [`\`\`\`${fence}`, ...lines(map)]; }
    if (skip && l === '```') { skip = false; return l; }
    return skip ? null : l;
  });
}
prWithMap('pr-mermaid-sequence', 'mermaid', `sequenceDiagram
    Contributor->>Branch: push
    Branch-->>Contributor: no docs run
`);
prWithMap('pr-mermaid-flowchart', 'mermaid', `flowchart LR
    A[Contributor] --> B[open PR into main]
    B --> C(one docs run)
`);
prWithMap('pr-mermaid-graph', 'mermaid', `graph TD
    A[Contributor] ==> B[one docs run]
`);
prWithMap('pr-mermaid-no-header', 'mermaid', `    A[Contributor] --> B[one docs run]
    B --> C(done)
`);
prWithMap('pr-mermaid-bad-direction', 'mermaid', `flowchart
    A[Contributor] --> B[one docs run]
`);
prWithMap('pr-mermaid-header-only', 'mermaid', `flowchart LR
`);
prWithMap('pr-mermaid-semicolon', 'mermaid', `sequenceDiagram
    Contributor->>Branch: push; then wait
    Branch-->>Contributor: no docs run
`);
prWithMap('pr-mermaid-file-name', 'mermaid', `flowchart LR
    A[Contributor] --> B[docs-guardrails.yml]
`);
prWithMap('pr-mermaid-no-arrow', 'mermaid', `flowchart LR
    A[Contributor]
    B[one docs run]
`);
{
  const rows = (n) => Array.from({ length: n }, (_, i) => `    A${i + 1}[a] --> B${i + 1}[b]\n`).join('');
  prWithMap('pr-mermaid-too-long', 'mermaid', `flowchart LR\n${rows(15)}`);
  prWithMap('pr-mermaid-fifteen-lines', 'mermaid', `flowchart LR\n${rows(14)}`);
}
expect('pass', 'pr-mermaid-sequence-valid', lint('pr', W('pr-mermaid-sequence'), '--risk', 'medium'));
expect('pass', 'pr-mermaid-flowchart-valid', lint('pr', W('pr-mermaid-flowchart'), '--risk', 'medium'));
expect('pass', 'pr-mermaid-graph-valid', lint('pr', W('pr-mermaid-graph'), '--risk', 'medium'));
expect('fail', 'pr-mermaid-missing-header', lint('pr', W('pr-mermaid-no-header'), '--risk', 'medium'));
expect('fail', 'pr-mermaid-flowchart-needs-direction', lint('pr', W('pr-mermaid-bad-direction'), '--risk', 'medium'));
expect('fail', 'pr-mermaid-header-only', lint('pr', W('pr-mermaid-header-only'), '--risk', 'medium'));
expect('fail', 'pr-mermaid-semicolon-in-sequence', lint('pr', W('pr-mermaid-semicolon'), '--risk', 'medium'));
expect('fail', 'pr-mermaid-file-name', lint('pr', W('pr-mermaid-file-name'), '--risk', 'medium'));
expect('fail', 'pr-mermaid-needs-arrow', lint('pr', W('pr-mermaid-no-arrow'), '--risk', 'medium'));
expect('fail', 'pr-mermaid-over-15-lines', lint('pr', W('pr-mermaid-too-long'), '--risk', 'medium'));
expect('pass', 'pr-mermaid-at-15-lines', lint('pr', W('pr-mermaid-fifteen-lines'), '--risk', 'medium'));
transform('plan-good', 'plan-mermaid', (l) => (/^## Risk/.test(l)
  ? ['## Impact map', '', '```mermaid', 'flowchart LR', '    A[Contributor] --> B[docs run]', '```', '', l] : l));
expect('fail', 'plan-mermaid-rejected', lint('plan', W('plan-mermaid')));
write('commit-mermaid', 'ci(trigger): run docs checks only on pull requests\n\nImpact: Contributors get one docs run per pull request, not two.\nWhy: Pushes ran the gate twice.\nRisk: high - trigger change; verified with a draft PR.\nRollback: revert\n\n```mermaid\nflowchart LR\n    A[Contributor] --> B[docs run]\n```\n');
expect('fail', 'commit-mermaid-rejected', lint('commit', W('commit-mermaid'), '--risk', 'high'));

// worst case line (round 2)
dropLines('pr-good', 'pr-no-worst', /^Worst case:/);
sub('pr-good', 'pr-worst-21-words', /^Worst case: .*$/, `Worst case: ${repeat('go ', 21)}`);
sub('pr-good', 'pr-worst-20-words', /^Worst case: .*$/, `Worst case: ${repeat('go ', 20)}`);
{
  let w = '';
  transform('pr-good', 'pr-worst-after-decision', (l) => {
    if (/^Worst case:/.test(l)) { w = l; return null; }
    if (/^Decision:/.test(l)) return [l, w];
    return l;
  });
}
transform('pr-good', 'pr-prose-between', (l) => (/^Decision:/.test(l) ? ['Reviewers should also note this.', '', l] : l));
transform('pr-good', 'pr-worst-blank-gap', (l) => (/^Worst case:/.test(l) ? [l, ''] : l));
transform('pr-good', 'pr-labels-at-limits', (l) => l
  .replace(/^Worst case: .*$/, `Worst case: ${repeat('go ', 20)}`)
  .replace(/^Decision: .*$/, `Decision: ${repeat('go ', 25)}`));
expect('fail', 'pr-worst-case-required-at-medium', lint('pr', W('pr-no-worst'), '--risk', 'medium'));
expect('pass', 'pr-worst-case-optional-at-low', lint('pr', W('pr-low-no-decision'), '--risk', 'low'));
expect('fail', 'pr-worst-case-over-20-words', lint('pr', W('pr-worst-21-words'), '--risk', 'medium'));
expect('pass', 'pr-worst-case-at-20-words', lint('pr', W('pr-worst-20-words'), '--risk', 'medium'));
expect('fail', 'pr-worst-case-after-decision', lint('pr', W('pr-worst-after-decision'), '--risk', 'medium'));
expect('fail', 'pr-worst-case-not-directly-before-decision', lint('pr', W('pr-prose-between'), '--risk', 'medium'));
expect('pass', 'pr-worst-case-blank-line-before-decision', lint('pr', W('pr-worst-blank-gap'), '--risk', 'medium'));
expect('pass', 'pr-worst-case-and-decision-not-in-impact-count', lint('pr', W('pr-labels-at-limits'), '--risk', 'medium'));

// commit Needs required at high; none rejected at high
dropLines('commit-rollback-revert', 'commit-high-no-needs', /^Needs:/);
sub('commit-rollback-revert', 'commit-high-needs-none', /^Needs: .*$/, 'Needs: None.');
transform('commit-rollback-revert', 'commit-medium-needs-none', (l) => l
  .replace(/^Needs: .*$/, 'Needs: None.')
  .replace(/^Risk: high/, 'Risk: medium'));
sub('commit-rollback-revert', 'commit-high-needs-nonetheless', /^Needs: .*$/, 'Needs: Nonetheless confirm the draft PR check ran.');
dropLines('commit-medium-no-rollback', 'commit-medium-no-needs', /^Needs:/);
expect('fail', 'commit-needs-required-at-high', lint('commit', W('commit-high-no-needs'), '--risk', 'high'));
expect('fail', 'commit-needs-none-rejected-at-high', lint('commit', W('commit-high-needs-none'), '--risk', 'high'));
expect('pass', 'commit-needs-none-allowed-at-medium', lint('commit', W('commit-medium-needs-none'), '--risk', 'medium'));
expect('pass', 'commit-needs-optional-at-medium', lint('commit', W('commit-medium-no-needs'), '--risk', 'medium'));
expect('pass', 'commit-needs-none-prefix-word-is-not-none', lint('commit', W('commit-high-needs-nonetheless'), '--risk', 'high'));
sub('pr-high-revert', 'pr-high-decision-none', /^Decision: .*$/, 'Decision: None beyond normal review.');
expect('fail', 'pr-decision-none-rejected-at-high', lint('pr', W('pr-high-decision-none'), '--risk', 'high'));
expect('pass', 'pr-decision-none-allowed-at-medium', lint('pr', W('pr-good'), '--risk', 'medium'));

// bold labels, case-insensitive rollback, field termination
transform('commit-rollback-revert', 'commit-bold-labels', (l) => l
  .replace(/^Needs: /, '**Needs:** ')
  .replace(/^Rollback: revert$/, '**Rollback:** Revert'));
sub('commit-rollback-revert', 'commit-rollback-upper', /^Rollback: revert$/, 'Rollback: IRREVERSIBLE: the dropped data');
transform('commit-rollback-revert', 'commit-trailer-after-rollback', (l) => (/^Rollback:/.test(l) ? [l, 'Co-Authored-By: Dana <dana@example.invalid>'] : l));
transform('commit-rollback-revert', 'commit-trailer-after-needs', (l) => (/^Needs:/.test(l) ? [l, 'Co-Authored-By: Dana <dana@example.invalid>'] : l));
transform('commit-rollback-revert', 'commit-needs-indented-continuation', (l) =>
  (/^Needs: .*$/.test(l) ? ['Needs: Confirm the draft PR check ran,', '  then merge.'] : l));
transform('pr-good', 'pr-bold-labels', (l) => l
  .replace(/^Decision: /, '**Decision:** ')
  .replace(/^Worst case: /, '**Worst case:** '));
sub('pr-high-revert', 'pr-bold-rollback', /^Rollback: revert$/, '**Rollback:** Revert');
{
  const a = repeat('go ', 13);
  transform('pr-good', 'pr-decision-indented-26', (l) => (/^Decision:/.test(l) ? [`Decision: ${a}`, `  ${a}`] : l));
  transform('pr-good', 'pr-decision-unindented-second-line', (l) => (/^Decision:/.test(l) ? [`Decision: ${a}`, a] : l));
}
expect('pass', 'commit-bold-labels', lint('commit', W('commit-bold-labels'), '--risk', 'high'));
expect('pass', 'commit-rollback-value-case-insensitive', lint('commit', W('commit-rollback-upper'), '--risk', 'high'));
expect('pass', 'commit-trailer-does-not-extend-rollback', lint('commit', W('commit-trailer-after-rollback'), '--risk', 'high'));
expect('pass', 'commit-trailer-does-not-extend-needs', lint('commit', W('commit-trailer-after-needs'), '--risk', 'high'));
expect('pass', 'commit-needs-indented-continuation', lint('commit', W('commit-needs-indented-continuation'), '--risk', 'high'));
expect('pass', 'pr-bold-decision-and-worst-case', lint('pr', W('pr-bold-labels'), '--risk', 'medium'));
expect('pass', 'pr-bold-rollback-case-insensitive', lint('pr', W('pr-bold-rollback'), '--risk', 'high'));
expect('fail', 'pr-decision-indented-continuation-counts', lint('pr', W('pr-decision-indented-26'), '--risk', 'medium'));
expect('pass', 'pr-decision-ends-at-unindented-line', lint('pr', W('pr-decision-unindented-second-line'), '--risk', 'medium'));

// map arrows and nodes (round 2)
mapCommit('commit-map-changed-marker-only', `    [Contributor] <- changed
    [Maintainer]  <- changed
`);
mapCommit('commit-map-short-arrow', `    [Contributor] -> [open PR into main]
    [Contributor] -> [push branch]
`);
mapCommit('commit-map-mixed-nodes', `    (Contributor) [opens PR] --> ok
    (Maintainer) --> [merges]
`);
expect('fail', 'map-changed-marker-is-not-an-arrow', lint('commit', W('commit-map-changed-marker-only'), '--risk', 'high'));
expect('pass', 'map-short-arrow-accepted', lint('commit', W('commit-map-short-arrow'), '--risk', 'high'));
expect('pass', 'map-mixed-node-types-counted-per-type', lint('commit', W('commit-map-mixed-nodes'), '--risk', 'high'));
prWithMap('pr-mermaid-semicolon-header', 'mermaid', `flowchart LR;
    A[Contributor] --> B[one docs run]
`);
expect('pass', 'pr-mermaid-header-trailing-semicolon', lint('pr', W('pr-mermaid-semicolon-header'), '--risk', 'medium'));

// facts: comment lines in the map, and outside a git repo
write('areas-commented.tsv', '# risk map\n\n.\tsource\tmedium\n');
write('facts-commented', node('facts.mjs', ['--staged'], { cwd: repo, env: envWith({ SO_WHAT_AREAS: W('areas-commented.tsv') }) }).stdout);
expect('pass', 'facts-skips-comment-and-blank-map-rows', hasMatch(W('facts-commented'), /^risk: medium \(driven by source\)/));
fs.mkdirSync(W('not-a-repo'), { recursive: true });
const factsNoGit = () => node('facts.mjs', ['--staged'], { cwd: W('not-a-repo'), env: envWith({ GIT_CEILING_DIRECTORIES: work }) });
expect('fail', 'facts-outside-git-fails', factsNoGit);
write('facts-nogit', factsNoGit().out);
expect('pass', 'facts-outside-git-says-why', hasMatch(W('facts-nogit'), /not inside a git repository/));
// a repo under a non-ASCII directory still reads its .so-what/areas.tsv
const uniRepo = W('José repo Сергій');
gitInit(uniRepo);
git(uniRepo, 'commit', '-q', '--allow-empty', '-m', 'base');
fs.mkdirSync(path.join(uniRepo, '.so-what'), { recursive: true });
fs.writeFileSync(path.join(uniRepo, '.so-what', 'areas.tsv'), '.\tcustom\thigh\n');
fs.writeFileSync(path.join(uniRepo, 'notes.md'), 'draft\n');
git(uniRepo, 'add', '.');
git(uniRepo, 'commit', '-q', '-m', 'notes');
write('facts-unicode-dir', node('facts.mjs', ['--base', 'HEAD~1', '--head', 'HEAD'], { cwd: uniRepo }).stdout);
expect('pass', 'facts-reads-areas-in-non-ascii-dir', hasMatch(W('facts-unicode-dir'), /^risk: high \(driven by custom\)/));
// a UTF-8 BOM is dropped; a UTF-16 file is refused
const factsWithAreas = (file) => node('facts.mjs', ['--staged'], { cwd: repo, env: envWith({ SO_WHAT_AREAS: W(file) }) });
fs.writeFileSync(W('areas-bom.tsv'), '\uFEFF^notes\\.md$\tbomrule\thigh\n.\tsource\tlow\n');
write('facts-bom', factsWithAreas('areas-bom.tsv').stdout);
expect('pass', 'facts-bom-areas-first-rule-matches', hasMatch(W('facts-bom'), /^risk: high \(driven by bomrule\)/));
fs.writeFileSync(W('areas-utf16.tsv'), Buffer.from('\uFEFF.\tsource\tlow\n', 'utf16le'));
expect('fail', 'facts-refuses-utf16-areas', () => factsWithAreas('areas-utf16.tsv'));
expect('pass', 'facts-utf16-says-why', () => /is UTF-16; save it as UTF-8/.test(factsWithAreas('areas-utf16.tsv').out));
fs.writeFileSync(W('subject-bom'), `\uFEFF${read(W('subject-good'))}`);
expect('pass', 'lint-bom-subject-passes', lint('subject', W('subject-bom')));
fs.writeFileSync(W('subject-utf16'), Buffer.from(`\uFEFF${read(W('subject-good'))}`, 'utf16le'));
expect('fail', 'lint-refuses-utf16', lint('subject', W('subject-utf16')));
expect('pass', 'lint-utf16-exits-2', () => node('lint.mjs', ['subject', W('subject-utf16')]).status === 2);
expect('fail', 'upsert-refuses-utf16', () => upsert(['--merge', W('subject-utf16'), W('pr-good')]));

// mmdc handling
makeStub(W('mmdc-launch'), 'mmdc', `process.stderr.write('Error: Failed to launch the browser process\\n');
process.exit(1);
`);
makeStub(W('mmdc-parse'), 'mmdc', `process.stderr.write('Parse error on line 2\\n');
process.exit(1);
`);
expect('pass', 'mmdc-launch-failure-is-skipped', lintWith({ env: envWith({}, W('mmdc-launch')) }, 'pr', W('pr-mermaid-sequence'), '--risk', 'medium'));
expect('fail', 'mmdc-parse-error-fails', lintWith({ env: envWith({}, W('mmdc-parse')) }, 'pr', W('pr-mermaid-sequence'), '--risk', 'medium'));

// forced negatives (subject, Impact, Worst case, Decision, Needs)
const negCommit = (name, needs) => sub('commit-good', `neg-${name}`, /^Needs: .*/, `Needs: ${needs}`);
const negSubject = (name, subject) => {
  const a = lines(read(W('commit-good')));
  a[0] = subject;
  write(`neg-${name}`, unlines(a));
};
const negPr = (name, label, value) => sub('pr-good', `neg-${name}`, new RegExp(`^${label}: .*`), `${label}: ${value}`);
negCommit('needs-not-but', 'This is not a risk but a decision to confirm.');
negCommit('needs-no-longer', 'Confirm the trigger no longer runs twice.');
negCommit('needs-instead', 'Confirm the check instead of the rerun.');
negCommit('needs-opens-no', 'No rerun is needed; confirm the check starts.');
negCommit('needs-clean', 'Confirm the draft-PR check starts before merging.');
negCommit('needs-not-alone', 'Confirm the check; do not merge before it starts.');
negSubject('subject-rather', 'ci(guardrails): run docs checks rather than skipping them');
expect('fail', 'neg-needs-not-but', lint('commit', W('neg-needs-not-but'), '--risk', 'high'));
expect('fail', 'neg-needs-no-longer', lint('commit', W('neg-needs-no-longer'), '--risk', 'high'));
expect('fail', 'neg-needs-instead-of', lint('commit', W('neg-needs-instead'), '--risk', 'high'));
expect('fail', 'neg-needs-opens-with-no', lint('commit', W('neg-needs-opens-no'), '--risk', 'high'));
expect('pass', 'neg-needs-clean-passes', lint('commit', W('neg-needs-clean'), '--risk', 'high'));
expect('pass', 'neg-not-without-but-passes', lint('commit', W('neg-needs-not-alone'), '--risk', 'high'));
expect('fail', 'neg-subject-rather-than', lint('commit', W('neg-subject-rather'), '--risk', 'high'));
write('neg-subject-not-just', 'ci: this is not just a tweak\n');
expect('fail', 'neg-subject-not-just', lint('subject', W('neg-subject-not-just')));
sub('pr-good', 'neg-pr-impact-isnt', /^was verified\./, "was verified, which isn't a diff recap.");
expect('fail', 'neg-pr-impact-isnt', lint('pr', W('neg-pr-impact-isnt'), '--risk', 'medium'));
negPr('pr-worst-never', 'Worst case', 'Never run this on a busy day.');
negPr('pr-decision-not-only', 'Decision', 'Approve this, not only the trigger change.');
negPr('pr-decision-its-not', 'Decision', "It's not urgent; approve before the release.");
expect('fail', 'neg-pr-worst-opens-never', lint('pr', W('neg-pr-worst-never'), '--risk', 'medium'));
expect('fail', 'neg-pr-decision-not-only', lint('pr', W('neg-pr-decision-not-only'), '--risk', 'medium'));
expect('fail', 'neg-pr-decision-its-not', lint('pr', W('neg-pr-decision-its-not'), '--risk', 'medium'));

// example blocks in the references lint clean
function extract(file, heading) {
  const out = [];
  let on = false;
  let open = 0;
  for (const l of lines(read(file))) {
    if (l === `## ${heading}`) { on = true; continue; }
    if (on && !open) {
      const m = /^`+/.exec(l);
      if (m) { open = m[0].length; continue; }
    }
    if (open) {
      if (/^`+$/.test(l) && l.length === open) break;
      out.push(l);
    }
  }
  return unlines(out);
}
const refs = path.join(here, '..', 'references');
write('ref-commit', extract(path.join(refs, 'commit.md'), 'Example'));
write('ref-pr', extract(path.join(refs, 'pull-request.md'), 'Example'));
write('ref-plan', extract(path.join(refs, 'plan.md'), 'Plan example'));
write('ref-commit-counter', extract(path.join(refs, 'commit.md'), 'Counter-example'));
expect('pass', 'ref-commit-example-lints', lint('commit', W('ref-commit'), '--risk', 'medium'));
expect('pass', 'ref-pr-example-lints', lint('pr', W('ref-pr'), '--risk', 'high'));
expect('pass', 'ref-pr-example-uses-mermaid', hasMatch(W('ref-pr'), /^```mermaid/));
expect('pass', 'ref-plan-example-lints', lint('plan', W('ref-plan'), '--risk', 'medium'));
expect('fail', 'ref-commit-counter-example-rejected', lint('commit', W('ref-commit-counter'), '--risk', 'high'));

process.stdout.write(`${passed} passed, ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
