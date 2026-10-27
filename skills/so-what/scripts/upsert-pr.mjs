#!/usr/bin/env node
// Insert or replace the so-what block in a PR body, between the markers.
// Node >= 18, stdlib only. Runs on macOS, Linux, and Windows.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const self = basename(process.argv[1] || fileURLToPath(import.meta.url));
const start = '<!-- so-what:start -->';
const end = '<!-- so-what:end -->';

// All text is handled as latin1 strings, so every byte passes through unchanged.
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
    } catch (e) {
      if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0);
      if (e.code !== 'EAGAIN') throw e;
    }
  }
}
const out = (text) => write(1, text);
const err = (text) => write(2, text);

function usage() {
  err(`usage: ${self} <pr-number> <block-file> [--kind pr|plan] --risk <floor> [--invariant "<name>"]... [--dry-run]\n`);
  err(`       ${self} <pr-number> --show\n`);
  err(`       ${self} --merge <body-file> <block-file>\n`);
  process.exit(2);
}

let work = '';
function cleanup() {
  // Windows can hold the file open briefly (EBUSY); a leftover temp dir is harmless.
  try {
    if (work) rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  } catch { /* leave it */ }
}
process.on('exit', cleanup);

// Run gh (or the SO_WHAT_GH stub). Exits like `set -e` when gh fails.
// A .cmd or .bat stub runs through the shell as one quoted command line.
function gh(args, stdout = 'pipe') {
  const stub = process.env.SO_WHAT_GH;
  const opts = { stdio: ['inherit', stdout, 'inherit'], maxBuffer: Infinity };
  const r = !stub
    ? spawnSync('gh', args, opts)
    : /\.(mjs|js)$/.test(stub)
      ? spawnSync(process.execPath, [stub, ...args], opts)
      : /\.(cmd|bat)$/i.test(stub)
        ? spawnSync([stub, ...args].map((a) => `"${a}"`).join(' '), { ...opts, shell: true })
        : spawnSync(stub, args, opts);
  if (r.error) {
    if (r.error.code === 'ENOENT') {
      err(`${self}: gh CLI not found; install it from https://cli.github.com\n`);
      process.exit(2);
    }
    err(`${self}: cannot run gh: ${bytes(r.error.message)}\n`);
    process.exit(2);
  }
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
  return r.stdout ? r.stdout.toString('latin1') : '';
}

// Lines of a text, like awk records: a final line without a newline still counts.
function lines(text) {
  if (text === '') return [];
  const all = text.split('\n');
  if (all[all.length - 1] === '') all.pop();
  return all;
}
const trimEnd = (line) => line.replace(/[ \t]+$/, '');

function markerState(text) {
  let starts = 0;
  let ends = 0;
  let startAt = 0;
  let endAt = 0;
  lines(text).forEach((raw, i) => {
    const line = trimEnd(raw);
    if (line === start) { starts++; if (!startAt) startAt = i + 1; }
    if (line === end) { ends++; if (!endAt) endAt = i + 1; }
  });
  if (!starts && !ends) return 'none';
  if (starts === 1 && ends === 1 && startAt < endAt) return 'one';
  return 'malformed';
}

function readable(p) {
  try { accessSync(p, constants.R_OK); return true; } catch { return false; }
}

// Returns { status, body, text }: body is the CR-stripped input, text the merged result.
function merge(bodyText, blockText) {
  const body = bodyText.replace(/\r/g, '');
  const block = blockText.replace(/\r/g, '');
  let text = '';
  switch (markerState(body)) {
    case 'none': {
      // Drop trailing blank lines, add one blank line, then append the block.
      const all = lines(body);
      let last = 0;
      all.forEach((line, i) => { if (/[^ \t\n]/.test(line)) last = i + 1; });
      for (let i = 0; i < last; i++) text += `${all[i]}\n`;
      if (last) text += '\n';
      text += block;
      break;
    }
    case 'one': {
      let skipping = false;
      for (const raw of lines(body)) {
        const line = trimEnd(raw);
        if (line === start) {
          for (const replacement of lines(block)) text += `${replacement}\n`;
          skipping = true;
          continue;
        }
        if (skipping) { if (line === end) skipping = false; continue; }
        text += `${raw}\n`;
      }
      break;
    }
    default:
      err(`${self}: PR body has unpaired, repeated, or out-of-order so-what markers; fix the body by hand, nothing was written\n`);
      return { status: 1 };
  }
  return { status: 0, body, text };
}

// A leading UTF-8 BOM is dropped; a UTF-16 file is refused.
function readOrFail(p) {
  if (!readable(p)) {
    err(`${self}: cannot read ${bytes(p)}\n`);
    process.exit(2);
  }
  let buf = readFileSync(p);
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    err(`${self}: ${bytes(p)} is UTF-16; save it as UTF-8\n`);
    process.exit(2);
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  return buf.toString('latin1');
}

const argv = process.argv.slice(2);
if (argv.length < 1) usage();

if (argv[0] === '--merge') {
  if (argv.length !== 3) usage();
  const bodyText = readOrFail(argv[1]);
  const blockText = readOrFail(argv[2]);
  const merged = merge(bodyText, blockText);
  if (merged.status !== 0) process.exit(merged.status);
  out(merged.text);
  process.exit(0);
}

if (argv.length < 2) usage();
const pr = argv[0];

if (argv[1] === '--show') {
  if (argv.length !== 2) usage();
  const body = gh(['pr', 'view', pr, '--json', 'body', '--jq', '.body']).replace(/\r/g, '');
  switch (markerState(body)) {
    case 'none': break;
    case 'one': {
      let on = false;
      let text = '';
      for (const raw of lines(body)) {
        const line = trimEnd(raw);
        if (line === start) on = true;
        if (on) text += `${raw}\n`;
        if (line === end) on = false;
      }
      out(text);
      break;
    }
    default:
      err(`${self}: PR body has unpaired, repeated, or out-of-order so-what markers\n`);
      process.exit(1);
  }
  process.exit(0);
}

const block = argv[1];
const rest = argv.slice(2);
let dryRun = 0;
let risk = '';
let kind = 'pr';
const lintArgs = [];
while (rest.length > 0) {
  switch (rest[0]) {
    case '--dry-run': dryRun = 1; rest.shift(); break;
    case '--risk': if (rest.length < 2) usage(); risk = rest[1]; rest.splice(0, 2); break;
    case '--kind': if (rest.length < 2) usage(); kind = rest[1]; rest.splice(0, 2); break;
    case '--invariant': if (rest.length < 2) usage(); lintArgs.push('--invariant', rest[1]); rest.splice(0, 2); break;
    default: usage();
  }
}
if (kind !== 'pr' && kind !== 'plan') usage();
if (risk === '') {
  err(`${self}: --risk <floor> is required (use the floor from facts.mjs, or none)\n`);
  usage();
}

// Lint the block first; lint's report goes to stderr.
const lint = spawnSync(process.execPath, [join(here, 'lint.mjs'), kind, block, '--risk', risk, ...lintArgs], {
  stdio: ['inherit', 2, 'inherit'],
});
if (lint.error) throw lint.error;
if (lint.status !== 0) process.exit(lint.status === null ? 1 : lint.status);

const body = gh(['pr', 'view', pr, '--json', 'body', '--jq', '.body']);
const merged = merge(body, readOrFail(block));
if (merged.status !== 0) process.exit(merged.status);
const next = merged.text;

if (dryRun === 1) {
  out(next);
} else if (merged.body === next) {
  err(`${self}: PR #${bytes(pr)} already current\n`);
} else {
  const now = gh(['pr', 'view', pr, '--json', 'body', '--jq', '.body']);
  if (body !== now) {
    err(`${self}: PR #${bytes(pr)} body changed while merging; nothing was written, run again\n`);
    process.exit(1);
  }
  work = mkdtempSync(join(tmpdir(), 'so-what-'));
  const nextFile = join(work, 'next');
  writeFileSync(nextFile, Buffer.from(next, 'latin1'));
  gh(['pr', 'edit', pr, '--body-file', nextFile], 'ignore');
  err(`${self}: PR #${bytes(pr)} recap updated\n`);
}
