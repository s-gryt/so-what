// Shared helpers for the eval scripts. Node >= 18, standard library only.
// Text that comes from model output is read as latin1 so every byte passes
// through unchanged, as awk and sed did with LC_ALL=C.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const sep = path.sep;

// script name as invoked, like ${0##*/}
export function prog() {
  return path.basename(process.argv[1] || '');
}

export function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

// join path parts with the platform separator, without normalizing them
export function cat(...parts) {
  return parts.join(sep);
}

// strip one trailing separator, like ${1%/}
export function stripSlash(p) {
  return p.endsWith('/') || p.endsWith(sep) ? p.slice(0, -1) : p;
}

// the shell's logical working directory ($PWD) when it is the real one
function logicalCwd() {
  const pwd = process.env.PWD;
  try {
    if (pwd && path.isAbsolute(pwd)) {
      const a = fs.statSync(pwd);
      const b = fs.statSync('.');
      if (a.dev === b.dev && a.ino === b.ino) return pwd;
    }
  } catch {
    // fall through
  }
  return process.cwd();
}

// absolute path without resolving symlinks, like $(cd "$p" && pwd)
export function absPath(p) {
  return path.resolve(logicalCwd(), p);
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// sort strings by their UTF-8 bytes (the C locale order)
export function byteSort(arr) {
  return arr.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

// directory entries that a shell glob `*` would list, in byte order
export function globNames(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return byteSort(names.filter((n) => !n.startsWith('.')));
}

// subdirectories a shell glob `*/` would list (symlinks to dirs included)
export function subdirs(dir) {
  return globNames(dir).filter((n) => isDir(cat(dir, n)));
}

// split text into awk records: a final newline ends the last record
export function records(text) {
  if (text === '') return [];
  const a = text.split('\n');
  if (a[a.length - 1] === '') a.pop();
  return a;
}

// content of a one-word file with CR and LF removed, like tr -d '\r\n'
export function readWord(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/[\r\n]/g, '');
  } catch {
    return die(`${prog()}: ${file}: No such file or directory`, 1);
  }
}

export function readBytes(file) {
  return fs.readFileSync(file, 'latin1');
}

export function writeBytes(file, text) {
  fs.writeFileSync(file, Buffer.from(text, 'latin1'));
}

// fill every {{NAME}} of a template; the trailing newlines become one
export function render(template, vars) {
  let t = fs.readFileSync(template, 'utf8').replace(/\n+$/, '');
  for (const [k, v] of Object.entries(vars)) t = t.split(`{{${k}}}`).join(v);
  return t + '\n';
}

// older skill versions used the `impact-recap:` marker; show it as `so-what:`
export function normalize(text) {
  return text
    .split('\n')
    .map((l) => l.replace('impact-recap:', 'so-what:'))
    .join('\n');
}

// List generated outputs: [arm, case, rN, path-to-out.txt].
// Layout is <run>/<arm>/<case>/r<N>/out.txt; an older <run>/<arm>/<case>/out.txt
// counts as r1 when no r1 exists.
export function listCells(runArg, only) {
  const run = stripSlash(runArg);
  const rows = [];
  for (const arm of subdirs(run)) {
    if (arm === 'blind' || arm === 'judge') continue;
    const armDir = cat(run, arm);
    for (const name of subdirs(armDir)) {
      if (only && name !== only) continue;
      const caseDir = cat(armDir, name);
      const legacy = cat(caseDir, 'out.txt');
      if (isFile(legacy) && !isFile(cat(caseDir, 'r1', 'out.txt'))) rows.push([arm, name, 'r1', legacy]);
      for (const r of subdirs(caseDir)) {
        if (!/^r[0-9]/.test(r)) continue;
        const out = cat(caseDir, r, 'out.txt');
        if (isFile(out)) rows.push([arm, name, r, out]);
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// headline view of one output (text in latin1, result in latin1)

function asciiLower(s) {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

// first sentence: cut at . ! ? followed by space or end, not after e.g / i.e
function firstSentence(s) {
  for (let i = 1; i <= s.length; i++) {
    const c = s[i - 1];
    if (c !== '.' && c !== '!' && c !== '?') continue;
    const nx = s.substr(i, 1);
    if (nx !== '' && nx !== ' ') continue;
    const pre = asciiLower(i > 3 ? s.substr(i - 4, 4) : s.substr(0, i));
    if (/(e\.g|i\.e|etc|vs)\.$/.test(pre) && nx !== '') continue;
    return s.substr(0, i);
  }
  return s;
}

const trim = (s) => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const plain = (s) => s.replace(/\*\*/g, '');
const blank = (s) => /^[ \t]*$/.test(s);
// a label line such as "Why:" or "Worst case:"
const isLabel = (s) => /^[A-Za-z][A-Za-z -]*:/.test(plain(s));
const sentenceEnd = /[.!?]([ ]|$)/;

function hasArrow(s) {
  if (s.includes('-->') || s.includes('==>') || s.includes('->')) return true;
  return s.indexOf('[') >= 0 && s.indexOf(']') > s.indexOf('[');
}

export function headline(text) {
  const line = [''];
  for (const l of records(text)) line.push(l.replace(/\r$/, ''));
  const n = line.length - 1;
  const out = [];

  // text after the colon on line k, plus wrapped continuation lines
  const joined = (k) => {
    let s = trim(plain(line[k]).replace(/^[^:]*:/, ''));
    for (let j = k + 1; j <= n && !blank(line[j]) && !/^#/.test(line[j]) && !/^```/.test(line[j]) && !isLabel(line[j]); j++) {
      s = s + ' ' + trim(plain(line[j]));
    }
    return s;
  };
  const find = (re) => {
    for (let i = 1; i <= n; i++) if (re.test(plain(line[i]))) return i;
    return 0;
  };

  let kind = '';
  let src = 0;
  for (let i = 1; i <= n; i++) {
    if (/^##[ \t]+Impact[ \t]*$/.test(line[i])) {
      src = i;
      kind = 'pr';
      break;
    }
  }
  if (!kind) {
    src = find(/^Impact:/);
    if (src) kind = 'commit';
  }

  let t = 0;
  for (let i = 1; i <= n; i++) {
    if (blank(line[i]) || /^[ \t]*<!--.*-->[ \t]*$/s.test(line[i])) continue;
    t = i;
    break;
  }
  // a PR output may lead with its title ("Title: ..." or a bare line)
  if (kind === 'pr' && t && t < src && !/^#/.test(line[t])) {
    out.push('Title: ' + trim(plain(line[t]).replace(/^Title:[ \t]*/, '')));
  } else if (kind === 'pr') out.push('Title: (none, PR body only)');
  else if (t && !/^Impact:/.test(line[t])) out.push('Title: ' + trim(line[t]));

  let imp = '';
  let j;
  if (kind === 'commit') imp = joined(src);
  else if (kind === 'pr') {
    for (j = src + 1; j <= n && blank(line[j]); j++);
    if (j <= n && !/^#/.test(line[j]) && !isLabel(line[j])) {
      imp = trim(line[j]);
      j++;
    }
    while (!sentenceEnd.test(imp) && j <= n && !blank(line[j]) && !/^#/.test(line[j]) && !/^```/.test(line[j]) && !isLabel(line[j])) {
      imp = imp + ' ' + trim(line[j]);
      j++;
    }
  } else if (t) {
    for (j = t + 1; j <= n && blank(line[j]); j++);
    if (j <= n) {
      imp = trim(line[j]);
      j++;
      while (!sentenceEnd.test(imp) && j <= n && !blank(line[j])) {
        imp = imp + ' ' + trim(line[j]);
        j++;
      }
    }
  }
  if (imp !== '') out.push('Impact: ' + firstSentence(imp));

  let k;
  if (kind === 'pr' && (k = find(/^Worst case:/))) out.push('Worst case: ' + joined(k));
  if (kind === 'commit' && (k = find(/^Risk:/))) out.push('Risk: ' + firstSentence(joined(k)));
  if ((k = find(/^Decision:/))) out.push('Decision: ' + joined(k));
  if ((k = find(/^Needs:/))) out.push('Needs: ' + joined(k));

  // map: accepted fence, else indented run with an arrow or node
  let infence = false;
  let prev = '';
  let s0 = 0;
  let e = 0;
  for (let i = 1; i <= n; i++) {
    if (/^```/.test(line[i])) {
      if (infence) infence = false;
      else {
        infence = true;
        if (/^```(text|mermaid)[ \t]*$/.test(line[i]) || /^##[ \t]+Impact map[ \t]*$/.test(prev)) {
          s0 = i;
          break;
        }
      }
    }
    if (!infence && !blank(line[i]) && !/^```/.test(line[i])) prev = line[i];
  }
  if (s0) {
    for (e = s0 + 1; e <= n && !/^```[ \t]*$/.test(line[e]); e++);
    out.push('Map:');
    for (let i = s0; i <= (e <= n ? e : n); i++) out.push(line[i]);
  } else {
    infence = false;
    let hit = false;
    for (let i = 1; i <= n && !s0; i++) {
      if (/^```/.test(line[i])) {
        infence = !infence;
        continue;
      }
      if (infence || !/^    [^ \t]/.test(line[i]) || /^    (- |\* )/.test(line[i])) continue;
      for (e = i; e <= n && /^    /.test(line[e]); e++) if (hasArrow(line[e])) hit = true;
      if (hit) s0 = i;
      else i = e;
      if (hit) break;
    }
    if (s0) {
      out.push('Map:');
      for (let i = s0; i < e; i++) out.push(line[i]);
    }
  }
  return out.map((l) => l + '\n').join('');
}

// ---------------------------------------------------------------------------
// seeded shuffle, identical to the earlier `cksum | awk srand()` pipeline
// on macOS (BSD awk on top of the libc random() generator)

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i << 24;
  for (let b = 0; b < 8; b++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  crcTable[i] = c >>> 0;
}

// POSIX cksum CRC of a buffer
export function cksum(buf) {
  let crc = 0;
  const upd = (b) => {
    crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  };
  for (const b of buf) upd(b);
  for (let len = buf.length; len > 0; len = Math.floor(len / 256)) upd(len & 0xff);
  return ~crc >>> 0;
}

// BSD random() (additive feedback, degree 31) seeded as srandom(seed);
// returns rand() in [0, 1) as awk computes it: random() / 2^31
function bsdRand(seed) {
  const st = new Int32Array(31);
  st[0] = seed | 0;
  for (let i = 1; i < 31; i++) {
    let x = st[i - 1];
    if (x === 0) x = 123459876;
    const hi = Math.trunc(x / 127773);
    const lo = x % 127773;
    x = 16807 * lo - 2836 * hi;
    if (x < 0) x += 0x7fffffff;
    st[i] = x;
  }
  let f = 3;
  let r = 0;
  const next = () => {
    st[f] = (st[f] + st[r]) | 0;
    const v = (st[f] >>> 1) & 0x7fffffff;
    f = (f + 1) % 31;
    r = (r + 1) % 31;
    return v;
  };
  for (let i = 0; i < 310; i++) next();
  return () => next() / 2147483648;
}

// Fisher-Yates shuffle of arms, seeded by the cksum of `key`
export function shuffle(arms, key) {
  const a = [null, ...arms];
  const rand = bsdRand(cksum(Buffer.from(key)));
  for (let i = a.length - 1; i > 1; i--) {
    const j = Math.floor(rand() * i) + 1;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(1);
}

// ---------------------------------------------------------------------------
// blind one case: shuffle every arm's output per run into labels X1..Xn.
// Returns the summary lines; stops the process on error.

export function blind(runArg, caseName, onlyRun) {
  const run = stripSlash(runArg);
  const cells = listCells(run, caseName);
  let runs = byteSort([...new Set(cells.map((c) => c[2]))]);
  if (runs.length === 0) die(`blind.mjs: no outputs for ${caseName}`, 1);
  if (onlyRun !== undefined) {
    if (!runs.includes(onlyRun)) die(`blind.mjs: no run ${onlyRun} for ${caseName}`, 1);
    runs = [onlyRun];
  }
  fs.mkdirSync(cat(run, 'blind'), { recursive: true });
  const summary = [];
  for (const r of runs) {
    const base = cat(run, 'blind', `${caseName}.${r}`);
    const arms = shuffle(byteSort(cells.filter((c) => c[2] === r).map((c) => c[0])), `${caseName}.${r}`);
    fs.writeFileSync(`${base}.key`, arms.map((a, i) => `X${i + 1}\t${a}\n`).join(''));
    let md = '';
    let hl = '';
    arms.forEach((arm, i) => {
      const label = `X${i + 1}`;
      const cell = cells.find((c) => c[0] === arm && c[2] === r);
      const text = normalize(readBytes(cell[3]));
      md += `===== OUTPUT ${label} =====\n${text}\n\n`;
      hl += `===== OUTPUT ${label} =====\n${headline(text)}\n`;
    });
    writeBytes(`${base}.md`, md);
    writeBytes(`${base}.headline.md`, hl);
    summary.push(`${arms.length} outputs shuffled for ${caseName} ${r}`);
  }
  return summary;
}
