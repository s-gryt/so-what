#!/usr/bin/env node
// Join blind judge scores with the answer keys and print per-arm results.
//   aggregate.mjs <run-dir>
// Reads <run>/judge/<case>.rN.tsv (six dimensions) and, when present,
// <run>/judge/<case>.rN.headline.tsv, unblinds with <run>/blind/<case>.rN.key.
// Core is out of 25 per case and run (impact_first, accuracy, traps, risk,
// concision). Map and headline are out of 5. Means are over all judged cells.
// sd(core) is the standard deviation, across runs, of each run's mean core
// over cases; "-" with fewer than two runs. Invalid judge files stop the script.
import fs from 'node:fs';
import path from 'node:path';
import { prog, die, cat, isDir, isFile, globNames, records, stripSlash } from './lib.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || !isDir(cat(args[0], 'judge'))) die(`usage: ${prog()} <run-dir>`, 2);
const run = stripSlash(args[0]);

// awk field splitting with a tab separator: an empty line has no fields
const fields = (l) => (l === '' ? [] : l.split('\t'));
const keyLabels = (key) => records(fs.readFileSync(key, 'utf8')).map((l) => fields(l));

// Strip CR, then require known labels, integer scores 1-5, and one row per
// key row. Returns the cleaned text, or null after naming each mismatch.
function check(file, key, nf, s1, s2) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const keys = keyLabels(key);
  const want = new Set(keys.map((f) => f[0] ?? ''));
  const got = new Set();
  let failed = false;
  let rows = 0;
  records(text).forEach((l, i) => {
    const bad = (msg) => {
      process.stderr.write(`aggregate.mjs: ${file}: line ${i + 1}: ${msg}\n`);
      failed = true;
    };
    const f = fields(l);
    if (f.length === 0) return;
    rows++;
    if (f.length < nf) bad(`expected ${nf} tab-separated fields, got ${f.length}`);
    if (!want.has(f[0])) bad(`label ${f[0]} is not in the key`);
    if (got.has(f[0])) bad(`label ${f[0]} appears twice`);
    got.add(f[0]);
    for (let k = s1; k <= s2; k++) {
      const v = f[k - 1] ?? '';
      if (!/^[1-5]$/.test(v)) bad(`score ${v} is not an integer 1-5`);
    }
  });
  if (rows !== keys.length) {
    process.stderr.write(`aggregate.mjs: ${file}: ${rows} rows, key has ${keys.length}\n`);
    failed = true;
  }
  return failed ? null : text;
}

const judgeDir = cat(run, 'judge');
const judged = globNames(judgeDir)
  .filter((f) => /^.*\.r[0-9].*\.tsv$/s.test(f) && isFile(cat(judgeDir, f)))
  .map((f) => path.basename(f, '.tsv'))
  .filter((name) => !name.endsWith('.headline'));

let ok = true;
const clean = new Map();
for (const name of judged) {
  const file = cat(judgeDir, `${name}.tsv`);
  const key = cat(run, 'blind', `${name}.key`);
  if (!isFile(key)) {
    process.stderr.write(`aggregate.mjs: ${file}: no key ${key}\n`);
    ok = false;
    continue;
  }
  const main = check(file, key, 8, 2, 7);
  if (main === null) ok = false;
  let head;
  const hfile = cat(judgeDir, `${name}.headline.tsv`);
  if (isFile(hfile)) {
    head = check(hfile, key, 3, 2, 2);
    if (head === null) ok = false;
  }
  clean.set(name, { main, head });
}
if (!ok) die('aggregate.mjs: judge files invalid, no table printed', 1);

// unblinded rows: arm, name, six scores, headline or NA
const rows = [];
for (const name of judged) {
  const { main, head } = clean.get(name);
  const arm = new Map();
  for (const f of keyLabels(cat(run, 'blind', `${name}.key`))) arm.set(f[0] ?? '', f[1] ?? '');
  const el = new Map();
  if (head !== undefined) for (const l of records(head)) el.set(fields(l)[0] ?? '', fields(l)[1] ?? '');
  for (const l of records(main)) {
    const f = fields(l);
    const g = (k) => f[k - 1] ?? '';
    rows.push([arm.get(g(1)) ?? '', name, g(2), g(3), g(4), g(5), g(6), g(7), el.has(g(1)) ? el.get(g(1)) : 'NA']);
  }
}

// awk string-to-number: the leading numeric prefix, else 0
const numRe = /^[ \t\n\f\r\v]*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/;
const num = (s) => {
  const m = numRe.exec(s);
  return m ? parseFloat(m[0]) : 0;
};
const looksNumeric = (s) => /^[ \t\n\f\r\v]*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?[ \t\n\f\r\v]*$/.test(s);
// awk `a > b` on two field values: numeric when both look numeric
const greater = (a, b) => (looksNumeric(a) && looksNumeric(b) ? num(a) > num(b) : Buffer.compare(Buffer.from(a), Buffer.from(b)) > 0);

// printf %.Nf: round half to even on the exact binary value, as C does
function fixed(x, d) {
  const neg = x < 0 || Object.is(x, -0);
  const [int, frac] = Math.abs(x).toFixed(100).split('.');
  let digits = int + frac.slice(0, d);
  const rest = frac.slice(d);
  const half = '5'.padEnd(rest.length, '0');
  if (rest > half || (rest === half && Number(digits[digits.length - 1]) % 2 === 1)) {
    digits = (BigInt(digits) + 1n).toString().padStart(digits.length, '0');
  }
  const ip = digits.slice(0, digits.length - d) || '0';
  return (neg ? '-' : '') + (d > 0 ? `${ip}.${digits.slice(digits.length - d)}` : ip);
}
const padL = (s, w) => String(s).padStart(w);
const padR = (s, w) => String(s).padEnd(w);
const int = (x) => String(Math.trunc(x));
// %04d of the case number after its first character, then the name
const natkey = (c) => {
  const v = Math.trunc(num(c.slice(1)));
  const s = String(Math.abs(v));
  return (v < 0 ? '-' + s.padStart(3, '0') : s.padStart(4, '0')) + c;
};

const sk = (...a) => a.join('\x1c');
const cells = new Map();
const sum = new Map();
const coreSum = new Map();
const esum = new Map();
const ecnt = new Map();
const rs = new Map();
const rn = new Map();
const rlist = new Map();
const cc = new Map();
const names = [];
const cnames = [];
const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);

for (const f of rows) {
  const [arm, full] = f;
  const r = full.replace(/^.*\.r/s, 'r');
  const cs = full.replace(/\.r[0-9]+$/, '');
  const core = num(f[2]) + num(f[3]) + num(f[4]) + num(f[5]) + num(f[6]);
  add(cells, arm, 1);
  for (let d = 3; d <= 8; d++) add(sum, sk(arm, d), num(f[d - 1]));
  add(coreSum, arm, core);
  if (f[8] !== 'NA') {
    add(esum, arm, num(f[8]));
    add(ecnt, arm, 1);
  }
  if (!rn.has(sk(arm, r))) rlist.set(arm, [...(rlist.get(arm) ?? []), r]);
  add(rs, sk(arm, r), core);
  add(rn, sk(arm, r), 1);
  const ck = sk(arm, cs);
  if (!cc.has(ck)) cc.set(ck, { core: 0, map: 0, n: 0, el: 0, en: 0 });
  const c = cc.get(ck);
  c.core += core;
  c.map += num(f[7]);
  c.n++;
  if (f[8] !== 'NA') {
    c.el += num(f[8]);
    c.en++;
  }
  if (!names.includes(arm)) names.push(arm);
  if (!cnames.includes(cs)) cnames.push(cs);
}

// insertion sorts, as in the earlier awk version
for (let i = 1; i < names.length; i++) {
  const key = names[i];
  let j;
  for (j = i - 1; j >= 0 && greater(names[j], key); j--) names[j + 1] = names[j];
  names[j + 1] = key;
}
for (let i = 1; i < cnames.length; i++) {
  const key = cnames[i];
  let j;
  for (j = i - 1; j >= 0 && natkey(cnames[j]) > natkey(key); j--) cnames[j + 1] = cnames[j];
  cnames[j + 1] = key;
}

let out = `${padR('arm', 10)} ${padL('cells', 5)} ${padL('impact', 6)} ${padL('accur', 6)} ${padL('traps', 6)} ${padL('risk', 6)} ${padL('concis', 6)} ${padL('map', 5)} ${padL('elev', 5)} ${padL('core/25', 8)} ${padL('sd(core)', 8)} ${padL('runs', 4)}\n`;
for (const arm of names) {
  const c = cells.get(arm);
  // sd across runs of the per-run mean core
  let k = 0;
  let s = 0;
  let ss = 0;
  for (const r of rlist.get(arm)) {
    const v = rs.get(sk(arm, r)) / rn.get(sk(arm, r));
    k++;
    s += v;
    ss += v * v;
  }
  let sd = '-';
  if (k > 1) {
    const mean = s / k;
    let v = (ss - k * mean * mean) / (k - 1);
    if (v < 0) v = 0;
    sd = fixed(Math.sqrt(v), 2);
  }
  const el = ecnt.get(arm) ? fixed(esum.get(arm) / ecnt.get(arm), 2) : '-';
  const m = (d) => fixed(sum.get(sk(arm, d)) / c, 2);
  out += `${padR(arm, 10)} ${padL(int(c), 5)} ${padL(m(3), 6)} ${padL(m(4), 6)} ${padL(m(5), 6)} ${padL(m(6), 6)} ${padL(m(7), 6)} ${padL(m(8), 5)} ${padL(el, 5)} ${padL(fixed(coreSum.get(arm) / c, 2), 8)} ${padL(sd, 8)} ${padL(int(k), 4)}\n`;
}
out += '\n';
out += 'per case, mean over runs: core/25 map/5 headline/5\n';
out += padR('case', 22) + names.map((a) => ' ' + padR(a, 18)).join('') + '\n';
for (const cs of cnames) {
  out += padR(cs, 22);
  for (const arm of names) {
    const c = cc.get(sk(arm, cs));
    if (c && c.n) {
      const e = c.en ? fixed(c.el / c.en, 1) : '-';
      out += ' ' + padR(`${fixed(c.core / c.n, 1)} ${fixed(c.map / c.n, 1)} ${e} (n=${int(c.n)})`, 18);
    } else out += ' ' + padR('-', 18);
  }
  out += '\n';
}
process.stdout.write(out);
