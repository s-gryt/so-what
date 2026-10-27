#!/usr/bin/env node
// Prepare a run: one directory per arm, case and run, ready for generator agents.
//   prepare.mjs <run-dir> --arm name=<skill-dir|none>... [--cases c1,c2] [--runs N]
// Writes <run>/arms.tsv (arm<TAB>skill-dir-or-none) and, per cell,
//   <run>/<arm>/<case>/r<N>/repo/       setup.mjs repo for the case
//   <run>/<arm>/<case>/r<N>/skill/      copy of the arm's skill without evals/, .omc/ and scripts/test.* (absent for none)
//   <run>/<arm>/<case>/r<N>/prompt.md   generate.md rendered; the agent writes out.txt next to it
// Prints one absolute prompt path per cell. Calls no model.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { here, prog, die, cat, absPath, isDir, isFile, subdirs, records, readWord, render } from './lib.mjs';

const usage = () => die(`usage: ${prog()} <run-dir> --arm name=<skill-dir|none>... [--cases c1,c2] [--runs N]`, 2);

const args = process.argv.slice(2);
if (args.length < 1) usage();
let run = args.shift();
const arms = [];
let cases = '';
let runs = '1';
while (args.length > 0) {
  const a = args[0];
  if (a === '--arm' || a === '--cases' || a === '--runs') {
    if (args.length < 2) usage();
    if (a === '--arm') arms.push(args[1]);
    else if (a === '--cases') cases = args[1];
    else runs = args[1];
    args.splice(0, 2);
  } else usage();
}
if (arms.filter((s) => s !== '').length === 0) usage();
if (!/^[0-9]+$/.test(runs) || runs === '0') usage();
const nRuns = Number(runs);
if (cases === '') cases = subdirs(cat(here, 'fixtures')).join(',');

fs.mkdirSync(run, { recursive: true });
run = absPath(run);
const armsFile = cat(run, 'arms.tsv');
if (!fs.existsSync(armsFile)) fs.writeFileSync(armsFile, '');

const now = new Set();
for (const spec of arms) {
  if (spec === '') continue;
  const eq = spec.indexOf('=');
  if (eq <= 0) usage();
  const name = spec.slice(0, eq);
  let dir = spec.slice(eq + 1);
  if (name === 'blind' || name === 'judge' || /[^A-Za-z0-9_-]/.test(name)) die(`prepare.mjs: bad arm name ${name}`, 2);
  if (dir !== 'none') {
    if (!isFile(cat(dir, 'SKILL.md'))) die(`prepare.mjs: ${dir} has no SKILL.md`, 2);
    dir = absPath(dir);
  }
  now.add(name);
  // replace this arm's row, keep the others
  const rows = records(fs.readFileSync(armsFile, 'utf8')).filter((l) => l.split('\t')[0] !== name);
  rows.push(`${name}\t${dir}`);
  fs.writeFileSync(armsFile + '.new', rows.map((l) => l + '\n').join(''));
  fs.renameSync(armsFile + '.new', armsFile);
}

// copy a skill without evals/, any .omc and the skill's own test script
function copySkill(dir, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(dir)) {
    if (e.startsWith('..') || e === 'evals' || e === '.omc') continue;
    fs.cpSync(cat(dir, e), cat(dest, e), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => path.basename(src) !== '.omc',
    });
  }
  fs.rmSync(cat(dest, 'scripts', 'test.sh'), { force: true });
  fs.rmSync(cat(dest, 'scripts', 'test.mjs'), { force: true });
}

const caseList = cases.split(/[,\s]+/).filter((c) => c !== '');
for (const row of records(fs.readFileSync(armsFile, 'utf8'))) {
  const line = row.replace(/^\t+|\t+$/g, '');
  const tab = line.indexOf('\t');
  const name = tab < 0 ? line : line.slice(0, tab);
  const dir = tab < 0 ? '' : line.slice(tab + 1).replace(/^\t+/, '');
  if (!now.has(row.split('\t')[0])) continue;
  for (const c of caseList) {
    if (!isDir(cat(here, 'fixtures', c))) die(`prepare.mjs: no such case: ${c}`, 2);
    const mode = readWord(cat(here, 'fixtures', c, 'mode'));
    for (let n = 1; n <= nRuns; n++) {
      const cell = cat(run, name, c, `r${n}`);
      fs.mkdirSync(cell, { recursive: true });
      const r = spawnSync(process.execPath, [cat(here, 'setup.mjs'), c, cat(cell, 'repo')], {
        stdio: ['inherit', 'ignore', 'inherit'],
      });
      if (r.status !== 0) process.exit(r.status ?? 1);
      const v = { WHAT: '', REPO: cat(cell, 'repo'), STATE: '', SKILL_DIR_NOTE: '', SKILL_STEPS: '', OUT: cat(cell, 'out.txt') };
      let scope;
      if (mode === 'commit') {
        v.WHAT = 'commit message';
        v.STATE = 'the change is staged on branch main (git diff --staged)';
        scope = '--staged';
      } else {
        v.WHAT = 'pull request description';
        v.STATE = 'branch feature is one commit ahead of main (git diff main...feature)';
        scope = '--base main --head feature';
      }
      if (dir === 'none') {
        v.SKILL_STEPS = '- Read the change with git diff. Do not read the git log or any original commit message.';
      } else {
        const skill = cat(cell, 'skill');
        copySkill(dir, skill);
        // an older skill version may ship only the bash facts script
        const facts = isFile(cat(skill, 'scripts', 'facts.mjs'))
          ? `node ${cat(skill, 'scripts', 'facts.mjs')}`
          : `bash ${cat(skill, 'scripts', 'facts.sh')}`;
        v.SKILL_DIR_NOTE = ` and the skill copy in ${skill}`;
        v.SKILL_STEPS = `- First read ${cat(skill, 'SKILL.md')} and follow it exactly to write the text. Gather the facts by running, from inside ${v.REPO}, \`${facts} ${scope} --no-log\`. Do not read the git log or any original commit message.`;
      }
      fs.writeFileSync(cat(cell, 'prompt.md'), render(cat(here, 'prompts', 'generate.md'), v));
      process.stdout.write(cat(cell, 'prompt.md') + '\n');
    }
  }
}
