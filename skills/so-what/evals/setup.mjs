#!/usr/bin/env node
// Build a throwaway git repo for one eval case.
//   commit mode: base committed on main, change staged.
//   pr mode:     base committed on main, change committed on branch feature.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { here, prog, die, cat, readWord } from './lib.mjs';

const args = process.argv.slice(2);
if (args.length !== 2) die(`usage: ${prog()} <case> <dest-dir>`, 2);
const caseDir = cat(here, 'fixtures', args[0]);
const dest = args[1];
if (!fs.existsSync(caseDir) || !fs.statSync(caseDir).isDirectory()) die(`setup.mjs: no such case: ${args[0]}`, 2);
if (fs.existsSync(dest) && (!fs.statSync(dest).isDirectory() || fs.readdirSync(dest).length > 0)) {
  die(`setup.mjs: ${dest} is not empty`, 2);
}

function run(argv) {
  const r = spawnSync('git', argv, { stdio: 'inherit' });
  if (r.error) die(`setup.mjs: git: ${r.error.message}`, 127);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const g = (...a) =>
  run(['-C', dest, '-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', '-c', 'commit.gpgsign=false', ...a]);

fs.mkdirSync(dest, { recursive: true });
run(['init', '-q', dest]);
run(['-C', dest, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
run(['-C', dest, 'config', 'core.autocrlf', 'false']);

fs.cpSync(cat(caseDir, 'base'), dest, { recursive: true, verbatimSymlinks: true });
g('add', '-A');
g('commit', '-q', '-m', 'base');

const mode = readWord(cat(caseDir, 'mode'));
const patch = cat(caseDir, 'change.patch');
if (mode === 'commit') {
  g('apply', '--index', '--whitespace=nowarn', patch);
} else if (mode === 'pr') {
  g('checkout', '-q', '-b', 'feature');
  g('apply', '--index', '--whitespace=nowarn', patch);
  g('commit', '-q', '-m', 'wip');
} else {
  die(`setup.mjs: bad mode ${mode}`, 2);
}
process.stdout.write(mode + '\n');
