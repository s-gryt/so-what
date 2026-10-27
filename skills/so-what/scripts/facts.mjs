#!/usr/bin/env node
// Collect the facts for a commit or PR recap: scope, size, areas, risk floor.
// Node >= 18, stdlib only. Runs on macOS, Linux, and Windows.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const self = basename(process.argv[1] || fileURLToPath(import.meta.url));

// All text is handled as latin1 strings, so every byte from git and the
// map files passes through unchanged (like awk in the C locale).
const bytes = (s) => Buffer.from(s, 'utf8').toString('latin1');

// Write every byte: retry EAGAIN and partial writes; a closed pipe (EPIPE) ends
// the script quietly. A Windows console gets UTF-8 text through the stream, which
// Node writes synchronously to a TTY; raw bytes would show in the console code page.
const winTTY = process.platform === 'win32' ? [false, isatty(1), isatty(2)] : [];
function write(fd, text) {
  const buf = Buffer.from(text, 'latin1');
  if (winTTY[fd]) {
    (fd === 1 ? process.stdout : process.stderr).write(buf.toString('utf8'));
    return;
  }
  let off = 0;
  while (off < buf.length) {
    try {
      off += writeSync(fd, buf, off, buf.length - off);
    } catch (err) {
      if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
      if (err.code !== 'EAGAIN') throw err;
    }
  }
}
const out = (text) => write(1, text);
const err = (text) => write(2, text);

// Run git; stdout is captured, stderr goes to ours unless quiet.
// A path for fs calls is decoded as UTF-8 (encoding 'utf8'); other output stays latin1.
function git(args, quiet = false, encoding = 'latin1') {
  const r = spawnSync('git', args, {
    stdio: ['inherit', 'pipe', quiet ? 'ignore' : 'inherit'],
    maxBuffer: Infinity,
  });
  return { status: r.error ? 127 : r.status === null ? 128 : r.status, out: r.stdout ? r.stdout.toString(encoding) : '' };
}
// Like $(git ...): stdout without trailing newlines.
const sub = (args, quiet = false) => git(args, quiet).out.replace(/\n+$/, '');

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}
function readable(p) {
  try { accessSync(p, constants.R_OK); return true; } catch { return false; }
}
// Lines of a text file, like awk records; a trailing \r (Windows checkout) is dropped.
// A leading UTF-8 BOM is dropped; a UTF-16 file is refused.
function readLines(p) {
  let buf = readFileSync(p);
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    err(`${self}: ${bytes(p)} is UTF-16; save it as UTF-8\n`);
    process.exit(2);
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  const text = buf.toString('latin1');
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.replace(/\r$/, ''));
}

// The map files hold POSIX ERE patterns. JS RegExp reads the same syntax for
// these patterns; bracket classes like [[:alpha:]] are expanded first.
const posixClasses = {
  alpha: 'A-Za-z', digit: '0-9', alnum: '0-9A-Za-z', upper: 'A-Z', lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v', blank: ' \\t', xdigit: '0-9A-Fa-f',
  punct: '!-\\/:-@\\[-`{-~', cntrl: '\\x00-\\x1f\\x7f', print: ' -~', graph: '!-~',
};
const compiled = new Map();
function matches(path, pattern) {
  let re = compiled.get(pattern);
  if (!re) {
    try {
      re = new RegExp(pattern.replace(/\[:([a-z]+):\]/g, (m, c) => posixClasses[c] ?? m), 's');
    } catch {
      err(`${self}: invalid pattern: ${pattern}\n`);
      process.exit(2);
    }
    compiled.set(pattern, re);
  }
  return re.test(path);
}

if (git(['rev-parse', '--show-toplevel'], true).status !== 0) {
  err(`${self}: not inside a git repository; run it from the repo root\n`);
  process.exit(2);
}
let areas = join(here, 'areas.tsv');
// A repo can override the risk map: SO_WHAT_AREAS=<file>, or .so-what/areas.tsv at its root.
const toplevel = git(['rev-parse', '--show-toplevel'], true, 'utf8').out.replace(/\n+$/, '');
const repoAreas = `${toplevel}/.so-what/areas.tsv`;
if (process.env.SO_WHAT_AREAS) areas = process.env.SO_WHAT_AREAS;
else if (isFile(repoAreas)) areas = repoAreas;

function usage() {
  err(`usage: ${self} [--staged] [--base <rev>] [--head <rev>] [--no-log]\n`);
  process.exit(2);
}

let staged = 0;
let showLog = 1;
let ranged = 0;
let base = '';
let head = 'HEAD';
const args = process.argv.slice(2);
while (args.length > 0) {
  switch (args[0]) {
    case '--staged': staged = 1; args.shift(); break;
    case '--no-log': showLog = 0; args.shift(); break;
    case '--base': if (args.length < 2) usage(); base = args[1]; ranged = 1; args.splice(0, 2); break;
    case '--head': if (args.length < 2) usage(); head = args[1]; ranged = 1; args.splice(0, 2); break;
    default: usage();
  }
}

if (staged === 1 && ranged === 1) {
  err(`${self}: --staged cannot be combined with --base or --head\n`);
  usage();
}

// Optional invariants: .so-what/invariants.tsv at the repo root, or SO_WHAT_INVARIANTS=<file>.
let invariants = '';
const repoInvariants = `${toplevel}/.so-what/invariants.tsv`;
if (process.env.SO_WHAT_INVARIANTS) invariants = process.env.SO_WHAT_INVARIANTS;
else if (isFile(repoInvariants)) invariants = repoInvariants;
if (invariants !== '' && !readable(invariants)) {
  err(`${self}: cannot read ${bytes(invariants)}\n`);
  process.exit(2);
}

let diffArgs;
if (staged === 1) {
  diffArgs = ['--cached'];
  out(`scope: staged changes on ${sub(['rev-parse', '--abbrev-ref', 'HEAD'])}\n`);
} else {
  if (base === '') {
    base = git(['rev-parse', '-q', '--verify', 'origin/main']).status === 0 ? 'origin/main' : 'main';
  }
  const mb = git(['merge-base', base, head]);
  if (mb.status !== 0) process.exit(mb.status);
  const mergeBase = mb.out.replace(/\n+$/, '');
  diffArgs = [mergeBase, head];
  const shortBase = sub(['rev-parse', '--short', mergeBase]);
  const shortHead = sub(['rev-parse', '--short', head]);
  out(`scope: ${bytes(base)}...${bytes(head)} (merge-base ${shortBase}, head ${shortHead})\n`);
  out(`commits: ${sub(['rev-list', '--count', `${mergeBase}..${head}`])}\n`);
  if (sub(['status', '--porcelain', '--untracked-files=no']) !== '') {
    err(`${self}: uncommitted changes are not in this range; commit them first to describe them\n`);
  }
  if (showLog === 1) {
    const log = git(['log', '--no-merges', '--format=  %h %s', `${mergeBase}..${head}`]);
    out(log.out);
    if (log.status !== 0) process.exit(log.status);
  }
}

const nameStatus = git(['-c', 'core.quotepath=off', 'diff', '--no-renames', '--name-status', ...diffArgs]);
if (nameStatus.status !== 0) process.exit(nameStatus.status);
const numstat = git(['-c', 'core.quotepath=off', 'diff', '--no-renames', '--numstat', ...diffArgs]);
if (numstat.status !== 0) process.exit(numstat.status);

if (numstat.out === '') {
  out('files: 0\nrisk: none\n');
  err(`${self}: no changes in scope; nothing to describe\n`);
  process.exit(1);
}

const textLines = (text) => {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};
const rank = (level) => (level === 'high' ? 3 : level === 'medium' ? 2 : level === 'low' ? 1 : 0);
const skip = /^[ \t]*(#|$)/;

const invRules = [];
if (invariants !== '') {
  let entries = [];
  try { entries = readLines(invariants); } catch { entries = []; }
  for (const entry of entries) {
    if (skip.test(entry)) continue;
    const cols = entry.split('\t');
    invRules.push({ pattern: cols[0] ?? '', name: cols[1] ?? '', owner: (cols[2] ?? '') === '' ? 'unowned' : cols[2] });
  }
}

let areaLines;
try {
  areaLines = readLines(areas);
} catch {
  err(`${self}: cannot read ${bytes(areas)}\n`);
  process.exit(2);
}
const rules = [];
for (const entry of areaLines) {
  if (skip.test(entry)) continue;
  const cols = entry.split('\t');
  rules.push({ pattern: cols[0] ?? '', area: cols[1] ?? '', risk: cols[2] ?? '' });
}

const status = new Map();
for (const entry of textLines(nameStatus.out)) {
  const cols = entry.split('\t');
  status.set(cols[1] ?? '', cols[0] ?? '');
}

const touched = new Set();
const order = [];
const areaFiles = new Map();
const areaAdded = new Map();
const areaRemoved = new Map();
const areaRisk = new Map();
let top = '';
let topArea = '';
let totalAdded = 0;
let totalRemoved = 0;
const lines = [];
for (const entry of textLines(numstat.out)) {
  const cols = entry.split('\t');
  const path = cols[2] ?? '';
  const binary = cols[0] === '-';
  const added = binary ? 0 : parseInt(cols[0], 10) || 0;
  const removed = binary ? 0 : parseInt(cols[1], 10) || 0;
  // The last rule is the fallback: it applies when no earlier rule matches.
  let rule = 0;
  for (; rule < rules.length - 1; rule++) if (matches(path, rules[rule].pattern)) break;
  const area = rules[rule]?.area ?? '';
  let risk = rules[rule]?.risk ?? '';
  if (status.get(path) === 'D' && rank(risk) < 2) risk = 'medium';
  invRules.forEach((inv, i) => { if (matches(path, inv.pattern)) touched.add(i); });
  if (!areaFiles.has(area)) order.push(area);
  areaFiles.set(area, (areaFiles.get(area) ?? 0) + 1);
  areaAdded.set(area, (areaAdded.get(area) ?? 0) + added);
  areaRemoved.set(area, (areaRemoved.get(area) ?? 0) + removed);
  if (rank(risk) > rank(areaRisk.get(area) ?? '')) areaRisk.set(area, risk);
  if (rank(risk) > rank(top)) { top = risk; topArea = area; }
  totalAdded += added;
  totalRemoved += removed;
  lines.push(`  ${status.get(path) ?? ''}  ${area.padEnd(8)} ${risk.padEnd(6)} ${path}${binary ? '  (binary)' : `  +${added} -${removed}`}`);
}

if (touched.size > 0 && rank(top) < 2) { top = 'medium'; topArea = 'invariants'; }
let report = '';
report += `files: ${lines.length}  +${totalAdded} -${totalRemoved}\n`;
report += `risk: ${top} (driven by ${topArea})\n`;
report += 'areas:\n';
for (let level = 3; level >= 1; level--) {
  for (const area of order) {
    const risk = areaRisk.get(area) ?? '';
    if (rank(risk) === level) {
      report += `  ${area.padEnd(8)} ${risk.padEnd(6)} ${String(areaFiles.get(area)).padStart(3)} files  +${areaAdded.get(area)} -${areaRemoved.get(area)}\n`;
    }
  }
}
if (touched.size > 0) {
  report += 'invariants touched:\n';
  const printed = new Set();
  invRules.forEach((inv, i) => {
    if (touched.has(i) && !printed.has(inv.name)) {
      printed.add(inv.name);
      report += `  invariant: ${inv.name} (owner: ${inv.owner})\n`;
    }
  });
}
report += 'changes:\n';
for (const line of lines) report += `${line}\n`;
out(report);
