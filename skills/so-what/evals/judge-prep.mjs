#!/usr/bin/env node
// Prepare judging: blind every case and run, then render the judge prompts.
//   judge-prep.mjs <run-dir>
// For each case and run writes, with absolute paths filled in,
//   <run>/judge/<case>.rN.prompt.md           from prompts/judge.md
//   <run>/judge/<case>.rN.headline.prompt.md  from prompts/headline-judge.md
// Judges write <case>.rN.tsv and <case>.rN.headline.tsv next to them.
// Prints each prompt path. Calls no model.
import fs from 'node:fs';
import { here, prog, die, cat, absPath, isDir, byteSort, globNames, listCells, readWord, render, blind } from './lib.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || !isDir(args[0])) die(`usage: ${prog()} <run-dir>`, 2);
const run = absPath(args[0]);
fs.mkdirSync(cat(run, 'judge'), { recursive: true });

const out = [];
for (const c of byteSort([...new Set(listCells(run).map((x) => x[1]))])) {
  blind(run, c);
  const v = {
    CASE: c,
    MODE: readWord(cat(here, 'fixtures', c, 'mode')),
    FLOOR: readWord(cat(here, 'fixtures', c, 'floor')),
    CASES: cat(here, 'cases.md'),
    PATCH: cat(here, 'fixtures', c, 'change.patch'),
    BLIND: '',
    HEADLINE: '',
    JUDGE_OUT: '',
  };
  const keyName = new RegExp('^' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.r[0-9].*\\.key$', 's');
  for (const key of globNames(cat(run, 'blind')).filter((f) => keyName.test(f))) {
    const r = 'r' + key.slice(key.lastIndexOf('.r') + 2).replace(/\.key$/, '');
    const base = cat(run, 'blind', `${c}.${r}`);
    v.BLIND = `${base}.md`;
    v.HEADLINE = `${base}.headline.md`;
    v.JUDGE_OUT = cat(run, 'judge', `${c}.${r}.tsv`);
    const prompt = cat(run, 'judge', `${c}.${r}.prompt.md`);
    fs.writeFileSync(prompt, render(cat(here, 'prompts', 'judge.md'), v));
    process.stdout.write(prompt + '\n');
    v.JUDGE_OUT = cat(run, 'judge', `${c}.${r}.headline.tsv`);
    const hprompt = cat(run, 'judge', `${c}.${r}.headline.prompt.md`);
    fs.writeFileSync(hprompt, render(cat(here, 'prompts', 'headline-judge.md'), v));
    process.stdout.write(hprompt + '\n');
  }
}
