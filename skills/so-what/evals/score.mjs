#!/usr/bin/env node
// Mechanical scoring of eval outputs.
//   score.mjs <run-dir>      one row per arm, case and run
// Each arm is linted with the lint of the skill version it used, listed in
// <run>/arms.tsv (arm<TAB>skill-dir-or-none): scripts/lint.mjs, else the older
// scripts/lint.sh (run with bash, or $SO_WHAT_BASH). `none` arms, arms missing from the file, and
// skill dirs without a lint script use the current skill's lint.
// Repo invariants (column 2 of a fixture's .so-what/invariants.tsv) are passed as
// --invariant when that lint script supports the flag.
// Columns: arm, case, run, core (format rules other than the map), map
// (ok = present and valid, absent = no map, invalid = map rule broken), words.
// Older skill versions used another marker name and Mermaid; both are
// normalised or excluded from `core` so versions compare on equal terms.
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { here, prog, die, cat, isDir, isFile, records, listCells, readWord, readBytes, writeBytes, normalize, stripSlash } from './lib.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || !isDir(args[0])) die(`usage: ${prog()} <run-dir>`, 2);
const run = stripSlash(args[0]);

const pick = (dir) => [cat(dir, 'lint.mjs'), cat(dir, 'lint.sh')].find(isFile);
const currentDir = cat(here, '..', 'scripts');
const current = pick(currentDir) || cat(currentDir, 'lint.mjs');

const work = fs.mkdtempSync(cat(os.tmpdir(), 'so-what-score-'));
// Windows can hold a file open briefly (EBUSY); a leftover temp dir is harmless.
process.on('exit', () => {
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  } catch { /* leave it */ }
});

function lintFor(arm) {
  let dir = '';
  const armsFile = cat(run, 'arms.tsv');
  if (isFile(armsFile)) {
    const row = records(fs.readFileSync(armsFile, 'utf8')).find((l) => l.split('\t')[0] === arm);
    if (row !== undefined) dir = row.split('\t')[1] ?? '';
  }
  if (dir === '' || dir === 'none') return current;
  const lint = pick(cat(dir, 'scripts'));
  if (lint) return lint;
  process.stderr.write(`score.mjs: ${dir} has no scripts/lint.mjs or scripts/lint.sh for arm ${arm}; using current lint\n`);
  return current;
}

// run a lint script, stdout and stderr together; a lint that cannot run
// (spawn error, signal, or exit 2+) stops the scoring
function lint(arm, script, argv) {
  const cmd = script.endsWith('.mjs') ? process.execPath : process.env.SO_WHAT_BASH || 'bash';
  const r = spawnSync(cmd, [script, ...argv], { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status === null || r.status >= 2) {
    const detail = r.error ? `${cmd}: ${r.error.message}` : `${script} exited ${r.status ?? r.signal}: ${(r.stderr || '').trim()}`;
    die(`score.mjs: lint failed to run for arm ${arm}: ${detail}`, 2);
  }
  return (r.stdout || '') + (r.stderr || '');
}

const marker = /^<!-- so-what:start -->/;
process.stdout.write('arm\tcase\trun\tcore\tmap\twords\n');
for (const [arm, name, r, file] of listCells(run)) {
  const script = lintFor(arm);
  const mode = readWord(cat(here, 'fixtures', name, 'mode'));
  const floor = readWord(cat(here, 'fixtures', name, 'floor'));
  const text = normalize(readBytes(file));
  let body = text;
  const inv = [];
  const invFile = cat(here, 'fixtures', name, 'base', '.so-what', 'invariants.tsv');
  if (isFile(invFile) && fs.readFileSync(script, 'latin1').includes('--invariant')) {
    for (const l of records(fs.readFileSync(invFile, 'utf8'))) {
      if (l.startsWith('#') || l === '') continue;
      const f = l.split('\t');
      if (f.length >= 2 && f[1] !== '') inv.push('--invariant', f[1]);
    }
  }
  // A PR output may lead with its title ("Title: ..." or a bare subject)
  // before the marker block; lint the title as a subject, the block as pr.
  let titleLint = '';
  const lines = records(text);
  if (mode === 'pr' && !marker.test(text.split('\n')[0])) {
    const start = lines.findIndex((l) => marker.test(l));
    if (start >= 0) {
      let title = '';
      for (const l of lines) {
        if (marker.test(l)) break;
        if (/[^ \t]/.test(l)) {
          title = l.replace(/^Title:[ \t]*/, '') + '\n';
          break;
        }
      }
      body = lines.slice(start).map((l) => l + '\n').join('');
      writeBytes(cat(work, 'title'), title);
      titleLint = lint(arm, script, ['subject', cat(work, 'title')]);
    }
  }
  writeBytes(cat(work, 'out'), body);
  const result = lint(arm, script, [mode, cat(work, 'out'), '--risk', floor, ...inv]) + titleLint;
  const found = records(result);
  const core = found.filter(
    (l) => l !== '' && !l.includes('impact map:') && !l.includes('mermaid is not used') && !/^lint.sh: /.test(l) && !/^lint\.mjs: /.test(l),
  ).length;
  let map = 'ok';
  if (found.some((l) => l.includes('impact map: missing'))) map = 'absent';
  else if (found.some((l) => l.includes('impact map:'))) map = 'invalid';
  const words = readBytes(file).split(/[ \t\n\v\f\r]+/).filter((w) => w !== '').length;
  process.stdout.write(`${arm}\t${name}\t${r}\t${core === 0 ? 'pass' : `fail(${core})`}\t${map}\t${words}\n`);
}
