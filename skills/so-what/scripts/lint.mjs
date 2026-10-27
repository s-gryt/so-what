#!/usr/bin/env node
// Lint a commit subject, commit message, PR description, or plan.
// Exit 0: ok. Exit 1: findings. Exit 2: usage error or unreadable file.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tty from 'node:tty';
import { spawnSync } from 'node:child_process';

const self = path.basename(process.argv[1] || 'lint.mjs');

// Text is handled as latin1 "byte strings": one JS char per input byte.
// This matches the awk run under LC_ALL=C (length counts bytes, any byte
// outside 0x20-0x7E is non-ASCII, tolower touches A-Z only).
const toBytes = (text) => Buffer.from(String(text), 'utf8').toString('latin1');
// Write every byte: retry EAGAIN and partial writes; a closed pipe (EPIPE) ends
// the script quietly. A Windows console gets UTF-8 text through the stream, which
// Node writes synchronously to a TTY; raw bytes would show in the console code page.
const winTTY = process.platform === 'win32' ? [false, tty.isatty(1), tty.isatty(2)] : [];
function write(fd, text) {
  const buf = Buffer.from(text, 'latin1');
  if (winTTY[fd]) {
    (fd === 1 ? process.stdout : process.stderr).write(buf.toString('utf8'));
    return;
  }
  let off = 0;
  while (off < buf.length) {
    try {
      off += fs.writeSync(fd, buf, off, buf.length - off);
    } catch (e) {
      if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0);
      if (e.code !== 'EAGAIN') throw e;
    }
  }
}
const out = (text) => write(1, text);
const err = (text) => write(2, text);

function usage() {
  err(toBytes(`usage: ${self} subject|commit|pr|plan <file> [--risk none|low|medium|high] [--invariant "<name>"]...\n`));
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length < 2) usage();
const kind = argv[0];
const file = argv[1];
if (!['subject', 'commit', 'pr', 'plan'].includes(kind)) usage();

let floor = '';
let invariants = '';
for (let a = 2; a < argv.length;) {
  if (argv[a] === '--risk') {
    if (a + 1 >= argv.length) usage();
    floor = argv[a + 1]; a += 2;
  } else if (argv[a] === '--invariant') {
    if (a + 1 >= argv.length) usage();
    invariants = (invariants ? invariants + '\n' : '') + argv[a + 1]; a += 2;
  } else usage();
}
if (floor === 'none') floor = '';
else if (!['', 'low', 'medium', 'high'].includes(floor)) usage();

let raw;
try {
  fs.accessSync(file, fs.constants.R_OK);
  // awk reads a directory as an empty file; keep that result.
  raw = fs.statSync(file).isDirectory() ? Buffer.alloc(0) : fs.readFileSync(file);
} catch {
  err(toBytes(`lint.mjs: cannot read ${file}\n`));
  process.exit(2);
}
// A leading UTF-8 BOM is dropped; a UTF-16 file is refused.
if (raw.length >= 2 && ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff))) {
  err(toBytes(`lint.mjs: ${file} is UTF-16; save it as UTF-8\n`));
  process.exit(2);
}
if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) raw = raw.subarray(3);

// ---- checks ----

const FILENAME = toBytes(file);
let failures = 0;

const lower = (text) => text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
function rank(level) { return level === 'high' ? 3 : level === 'medium' ? 2 : level === 'low' ? 1 : 0; }
// exitCode is set first, so a closed pipe still exits 1 on findings.
function fail(message) { process.exitCode = 1; failures++; out(`${FILENAME}: ${message}\n`); }
function trim(text) { return text.replace(/^[ \t]+|[ \t]+$/g, ''); }
// awk split() with a regex separator: empty text has 0 fields.
function split(text, re) { return text === '' ? [] : text.split(re); }
function words(text) { return split(trim(text), /[ \t]+/).length; }
function bare(token) { return token.replace(/^[\][(`"']+|[\])`"',.;:!?]+$/g, ''); }
// Array lookup with awk semantics: a missing element reads as "".
const at = (list, i) => list[i] ?? '';
const get = (map, key) => map.get(key) ?? '';

// Label lines: "Label: value" or "**Label:** value". names is "A|B|C".
// Sets parsed_label and parsed_rest; returns true on a match.
let parsed_label = '';
let parsed_rest = '';
function parse_label(line, names) {
  let name, rest, m;
  if (/^\*\*[A-Za-z ]+:\*\*/.test(line)) { name = line.slice(2); name = name.slice(0, name.indexOf(':')); rest = line.slice(line.indexOf(':**') + 3); }
  else if ((m = /^[A-Za-z ]+:/.exec(line))) { name = m[0].slice(0, -1); rest = line.slice(m[0].length); }
  else return false;
  if (!`|${names}|`.includes(`|${name}|`)) return false;
  parsed_label = name;
  parsed_rest = rest.replace(/^[ \t]+/, '');
  return true;
}

// A field continues only on indented lines; any other line ends it.
function continues(line) { return /^[ \t]+[^ \t]/.test(line); }

function check_subject(subject) {
  if (!/^(feat|fix|docs|ci|build|chore|refactor|perf|test|style|revert)(\([a-z0-9._/-]+\))?!?: [^ ]/.test(subject))
    fail("subject must be '<type>(<scope>): <outcome>' with a conventional type and lowercase scope");
  if (subject.length > 72) fail(`subject is ${subject.length} bytes; limit is 72`);
  if (/\.$/.test(subject)) fail('subject must not end with a period');
  check_negatives('subject', subject);
}

function file_token(text) {
  for (const raw of split(text, /[ \t]+/)) {
    const token = bare(raw);
    if (/^[A-Z][A-Za-z]*\.js$/.test(token)) continue;
    if (/\.(sh|bash|py|ts|tsx|js|mjs|cjs|jsx|yml|yaml|json|toml|md|mdx|tsv|csv|awk|txt|lock|cfg|ini|sql|html|css|go|rs|rb|java|kt|swift|env)$/.test(token)) return token;
    if (/^(Dockerfile|Makefile|Justfile)$/.test(token)) return token;
  }
  return '';
}

function check_impact(label, text) {
  text = trim(text);
  if (text === '') { fail(`${label} is missing or empty`); return; }
  if (words(text) < minimum_words) fail(`${label} has ${words(text)} words; write at least ${minimum_words} about the consequence`);
  if (words(text) > maximum_words) fail(`${label} has ${words(text)} words; limit is ${maximum_words}, cut to the consequence a reader needs to decide`);
  const lead = text.replace(/[.!?]([ \t]|$).*/s, '');
  if (words(lead) > lead_words) fail(`${label} first sentence has ${words(lead)} words; limit is ${lead_words}, make it the whole point`);
  const opener = lower(bare(text.slice(0, (text + ' ').indexOf(' '))));
  check_negatives(label, text);
  if (edit_verbs.has(opener)) fail(`${label} opens with an edit verb (${opener}); open with who or what is affected`);
  const named = file_token(text);
  if (named !== '') fail(`${label} names a file (${named}); files are diff, impact is behavior`);
}

// Forced negatives: contrast and negation framing instead of stating what is true now.
function check_negatives(label, text) {
  for (const part of split(text, /[.!?]+(?:[ \t]|$)/)) {
    const sentence = ` ${lower(part)} `.replace(/[^a-z']+/g, ' ');
    if (/ not .* but /.test(sentence) || sentence.includes(' not just ') || sentence.includes(' not only ') ||
        sentence.includes(' no longer ') || sentence.includes(' instead of ') || sentence.includes(' rather than ') ||
        sentence.includes(" isn't ") || sentence.includes(" it's not ") || /^ (no|not|never) /.test(sentence)) {
      fail(`${label}: forced negative: state what is true now`);
      return;
    }
  }
}

function level_of(text) { return lower(trim(text)).replace(/[^a-z].*/s, ''); }

function max_rank(a, b) { return a > b ? a : b; }

// Label lines (Decision:, Needs:) share one limit: 25 words.
function check_label_words(label, text, limit) {
  text = trim(text);
  if (text === '') fail(`${label} is empty`);
  else if (words(text) > limit) fail(`${label} has ${words(text)} words; limit is ${limit}`);
  check_negatives(label, text);
}

// At high risk a Decision or Needs of "none" hides a real decision.
function check_not_none(label, text, risk_rank) {
  if (risk_rank >= 3 && /^none([^a-z]|$)/.test(lower(trim(text)))) fail(`${label} says none at high risk; state what the reader must decide`);
}

function rollback_ok(text) {
  text = lower(trim(text)).replace(/\.$/, '');
  return text === 'revert' || /^revert \+ [^ ]/.test(text) || /^irreversible: [^ ]/.test(text);
}

function check_rollback(label, text) {
  if (trim(text) === '') fail(`${label} is required at high risk: revert, revert + <extra step>, or irreversible: <what is lost>`);
  else if (!rollback_ok(text)) fail(`${label} must start with 'revert', 'revert + <extra step>', or 'irreversible: <what is lost>'`);
}

function check_not_verified(label, text) {
  text = lower(text);
  if (text.includes('not verified') && !text.includes('owner:')) fail(`${label} says not verified at high risk but names no 'owner:' who runs the check before merge`);
}

function check_invariants(label, text) {
  text = lower(text);
  for (const name of inv_name)
    if (!text.includes(lower(name))) fail(`${label} must name the touched invariant '${name}'`);
}

function check_level(label, text) {
  const level = level_of(text);
  if (rank(level) === 0) { fail(`${label} must start with low, medium, or high`); return; }
  if (rank(level) < rank(floor)) fail(`${label} is ${level} but facts.mjs rates the change ${floor}; never rate below the facts`);
}

// ASCII impact map: who is affected, joined by arrows to what now differs.
// map_line[1..map_count] hold the raw lines; map_at[] the file line numbers.
const map_line = [];
const map_at = [];
let map_count = 0;
function map_fail(message) { fail(`impact map: ${message}`); }

function map_char(row, col) {
  if (row < 1 || row > map_count) return ' ';
  // awk substr(s, 0, 1) returns the first character; col 0 maps to col 1.
  const ch = map_line[row].charAt(Math.max(col, 1) - 1);
  return ch === '' ? ' ' : ch;
}

function count_nodes(text, re) { return (text.match(re) || []).length; }

function map_nodes(text) {
  return count_nodes(text, /\[[^\]]*[A-Za-z][^\]]*\]/g) + count_nodes(text, /\([^)]*[A-Za-z][^)]*\)/g) + count_nodes(text, /\|[^|]*[A-Za-z][^|]*\|/g);
}

const occurrences = (text, ch) => text.split(ch).length - 1;

function check_map() {
  let arrows = 0;
  let nodes = 0;
  if (map_count < 2 || map_count > 12) map_fail(`has ${map_count} lines; use 2 to 12`);
  for (let row = 1; row <= map_count; row++) {
    const text = map_line[row];
    if (/[^ -~]/.test(text)) map_fail(`line ${map_at[row]} has a tab or non-ASCII character; use plain ASCII (+ - | > v) only`);
    if (text.length > 72) map_fail(`line ${map_at[row]} is ${text.length} characters; limit is 72`);
    if (/(-+|=+)>/.test(text) || /^[ ]*v[ ]*$/.test(text)) arrows++;
    nodes += map_nodes(text);
    if (occurrences(text, '[') !== occurrences(text, ']')) map_fail(`line ${map_at[row]} has unbalanced [ ]`);
    if (occurrences(text, '(') !== occurrences(text, ')')) map_fail(`line ${map_at[row]} has unbalanced ( )`);
    for (let col = 1; col <= text.length; col++) {
      const ch = text.charAt(col - 1);
      if (ch === '|' && !'|+v^'.includes(map_char(row - 1, col)) && !'|+v^'.includes(map_char(row + 1, col)))
        map_fail(`line ${map_at[row]}, column ${col}: '|' has nothing above or below it; box walls are misaligned`);
      if (ch === '+' && (/[-=]/.test(map_char(row, col - 1)) || /[-=]/.test(map_char(row, col + 1))) &&
          !'|+v^'.includes(map_char(row - 1, col)) && !'|+v^'.includes(map_char(row + 1, col)))
        map_fail(`line ${map_at[row]}, column ${col}: box corner '+' has no wall above or below it`);
    }
  }
  if (arrows < 1) map_fail("needs at least one arrow (-->, ==>, ->, or v under |; '<- changed' alone is not one) showing cause and effect");
  if (nodes < 2) map_fail('needs at least 2 labeled nodes ([who], [what changes], or boxes) joined by an arrow');
  let text = '';
  for (let row = 1; row <= map_count; row++) text = `${text} ${map_line[row]}`;
  const wide = file_token(text);
  if (wide !== '') map_fail(`names a file (${wide}); nodes name who or what behaves differently, not files`);
}

// Mermaid impact map (pull requests only): mechanical checks; mmdc parses it when installed.
function check_mermaid() {
  let shown = 0;
  let arrows = 0;
  let all = '';
  let first_line = '';
  for (let row = 1; row <= map_count; row++) {
    const text = trim(map_line[row]);
    if (text === '') continue;
    shown++;
    if (shown === 1) first_line = text;
    all = `${all} ${text}`;
    if (/(-->|->>|---|==>)/.test(text)) arrows++;
    if (/^sequenceDiagram/.test(first_line) && shown > 1 && /:.*;/.test(text)) map_fail(`line ${map_at[row]}: ';' inside sequence message text breaks the parser`);
  }
  if (!/^(sequenceDiagram|(flowchart|graph) (TD|TB|BT|RL|LR))[ \t]*;?$/.test(first_line))
    map_fail("mermaid must start with 'sequenceDiagram', 'flowchart <TD|TB|BT|RL|LR>', or 'graph <dir>'");
  if (shown < 2 || shown > 15) map_fail(`mermaid has ${shown} non-blank lines; use 2 to 15`);
  if (arrows < 1) map_fail('mermaid needs at least one arrow (-->, ->>, -->>, ---, ==>)');
  const named = file_token(all);
  if (named !== '') map_fail(`names a file (${named}); nodes name who or what behaves differently, not files`);
}

// BEGIN
const minimum_words = (kind === 'pr' || kind === 'plan') ? 20 : 8;
const maximum_words = (kind === 'pr' || kind === 'plan') ? 70 : 45;
const inv_name = split(toBytes(invariants), '\n');
const lead_words = 30;
const start_marker = '<!-- so-what:start -->';
const end_marker = '<!-- so-what:end -->';
const edit_verbs = new Set(('add adds added adding update updates updated updating change changes changed changing ' +
  'modify modifies modified modifying edit edits edited editing bump bumps bumped bumping ' +
  'touch touches touched touching tweak tweaks tweaked tweaking refactor refactors refactored refactoring ' +
  'remove removes removed removing rename renames renamed renaming move moves moved moving ' +
  'delete deletes deleted deleting create creates created creating introduce introduces introduced introducing ' +
  'replace replaces replaced replacing implement implements implemented implementing ' +
  'fix fixes fixed fixing drop drops dropped dropping enable enables enabled enabling ' +
  'disable disables disabled disabling switch switches switched switching migrate migrates migrated migrating ' +
  'convert converts converted converting extract extracts extracted extracting ' +
  'rewrite rewrites rewrote rewritten rewriting adjust adjusts adjusted adjusting ' +
  'improve improves improved improving enhance enhances enhanced enhancing').split(' '));

// Records: one per "\n"-terminated line; a trailing "\r" is dropped. lines[] is 1-based.
const text = raw.toString('latin1');
const records = text === '' ? [] : text.split('\n');
if (text.endsWith('\n')) records.pop();
const lines = [undefined, ...records.map((line) => line.replace(/\r$/, ''))];
const count = records.length;

// END
function lint() {
  if (count === 0) { fail('file is empty'); return; }

  if (kind === 'subject') { check_subject(lines[1]); return; }

  if (kind === 'commit') {
    const field = new Map();
    let current = '';
    let map_closed = false;
    check_subject(lines[1]);
    if (count > 1 && lines[2] !== '') fail('line 2 must be blank');
    for (let i = 2; i <= count; i++) {
      if (lines[i].length > 72 && !/https?:\/\//.test(lines[i])) fail(`line ${i} is ${lines[i].length} bytes; wrap body at 72`);
      if (/^[ \t]*```/.test(lines[i])) fail(`line ${i}: commits take an indented ASCII impact map, not a code fence or mermaid`);
      if (parse_label(lines[i], 'Why|Impact|Needs|Risk|Rollback')) {
        const label = parsed_label;
        if (field.has(label)) fail(`${label}: appears twice`);
        if (!field.has('Impact') && label !== 'Impact') fail(`${label}: appears before Impact:; Impact comes first`);
        if (label === 'Why' && field.has('Risk')) fail('Why: appears after Risk:; order is Impact, Why, Risk');
        if (label === 'Rollback' && !field.has('Risk')) fail('Rollback: appears before Risk:; it follows Risk:');
        field.set(label, parsed_rest);
        current = label;
      } else if ((current === 'Needs' || current === 'Rollback') && !continues(lines[i])) {
        current = '';
        if (lines[i] === '') { if (map_count > 0) map_closed = true; }
        else if (/^ {4}[^ ]/.test(lines[i]) && !map_closed) { map_line[++map_count] = lines[i]; map_at[map_count] = i; }
      } else if (lines[i] === '') {
        current = '';
        if (map_count > 0) map_closed = true;
      } else if (current === '' && /^ {4}[^ ]/.test(lines[i]) && !map_closed) {
        map_line[++map_count] = lines[i]; map_at[map_count] = i;
      } else if (current === '' && /^ {4}/.test(lines[i])) {
        fail(`line ${i}: a second indented block; commits carry one impact map`);
      } else if (current !== '') {
        field.set(current, `${field.get(current)} ${trim(lines[i])}`);
      }
    }
    const declared = field.has('Risk') ? level_of(field.get('Risk')) : '';
    const effective = max_rank(rank(floor), rank(declared));
    check_impact('Impact:', get(field, 'Impact'));
    if (field.has('Needs')) {
      check_label_words('Needs:', field.get('Needs'), 25);
      check_not_none('Needs:', field.get('Needs'), effective);
    } else if (effective >= 3) fail('Needs: is required at high risk; state what the reader must decide or do');
    if (map_count > 0) check_map();
    else if (rank(floor) >= 2) fail(`impact map: missing; at ${floor} risk add an indented ASCII map after Risk:, after a blank line`);
    if (rank(floor) >= 2 && trim(get(field, 'Why')) === '') fail(`Why: is required at ${floor} risk`);
    if (field.has('Risk')) check_level('Risk:', field.get('Risk'));
    else if (rank(floor) >= 2) fail(`Risk: is required at ${floor} risk`);
    if (effective >= 3) {
      check_rollback('Rollback:', get(field, 'Rollback'));
      check_not_verified('Risk:', get(field, 'Risk'));
    }
    check_invariants('Risk: or Rollback:', `${get(field, 'Risk')} ${get(field, 'Rollback')}`);
    return;
  }

  let first = 1; while (first <= count && trim(lines[first]) === '') first++;
  let last = count; while (last >= 1 && trim(at(lines, last)) === '') last--;
  if (trim(at(lines, first)) !== start_marker) fail(`first line must be ${start_marker}`);
  if (trim(at(lines, last)) !== end_marker) fail(`last line must be ${end_marker}`);

  // position keeps sections in document order (awk for-in order is unspecified).
  const position = new Map();
  const inside = new Map();
  const body = new Map();
  const ver_item = [];
  let fence = '';
  let section = '';
  let in_details = false;
  let details_seen = 0;
  let order = 0;
  let label_order = 0;
  let risk_heading = '';
  let impact_field = '';
  let in_rollback = false;
  let in_item = false;
  let map_mermaid = false;
  let decision_seen = false, decision = '', decision_order = 0;
  let worst_seen = false, worst = '', worst_order = 0;
  let prose_since_worst = false;
  let prose_words = 0;
  let rollback_seen = false, rollback = '';
  let risk_header = false, risk_rows = 0;
  let verification_items = 0, ver_n = 0;
  for (let i = first + 1; i < last; i++) {
    const line = lines[i];
    if (trim(line) === start_marker || trim(line) === end_marker) fail(`line ${i}: markers must appear exactly once`);
    if (/^[ \t]*```/.test(line)) {
      if (fence === '') {
        if (section === 'Impact map') {
          if (map_count > 0) fail(`line ${i}: ## Impact map holds one fenced diagram`);
          fence = 'map';
          if (/^[ \t]*```mermaid/.test(line)) {
            map_mermaid = true;
            if (kind !== 'pr') fail(`line ${i}: mermaid impact maps are for pull requests; use a \`\`\`text fence`);
          }
        } else fence = 'code';
        body.set(section, `${get(body, section)} ${fence}`);
      } else fence = '';
      continue;
    }
    if (fence === 'map') { map_line[++map_count] = line; map_at[map_count] = i; continue; }
    if (fence === 'code') continue;
    // HTML tag lines (<details>, <summary>...</summary>, </details>) are not prose.
    if (/^[ \t]*<\/?[a-z]+[^>]*>([^<]*<\/[a-z]+>)?[ \t]*$/.test(line)) {
      const tag = trim(line);
      if (/^<details/.test(tag)) {
        details_seen++;
        if (in_details) fail(`line ${i}: nested <details>`);
        in_details = true;
        section = '';
      } else if (/^<\/details>/.test(tag)) {
        if (!in_details) fail(`line ${i}: </details> without an opening <details>`);
        else if (trim(at(lines, i - 1)) !== '') fail(`line ${i}: leave a blank line before </details> so GitHub renders the markdown`);
        in_details = false;
        section = '';
      } else if (/^<summary/.test(tag) && trim(at(lines, i + 1)) !== '') {
        fail(`line ${i}: leave a blank line after </summary> so GitHub renders the markdown`);
      }
      continue;
    }
    if (/^## /.test(line)) {
      section = trim(line.slice(3));
      if (/^Risk:/.test(section)) { risk_heading = section.slice(5); section = 'Risk'; }
      if (position.has(section)) fail(`section '${section}' appears twice`);
      position.set(section, ++order);
      inside.set(section, in_details);
      impact_field = '';
      in_rollback = false;
      in_item = false;
      continue;
    }
    if (section === 'Impact') {
      if (parse_label(line, 'Decision|Worst case')) {
        impact_field = parsed_label;
        if (parsed_label === 'Decision') { decision_seen = true; decision = parsed_rest; decision_order = ++label_order; }
        else { worst_seen = true; worst = parsed_rest; worst_order = ++label_order; }
        prose_words += words(line);
        continue;
      }
      if (impact_field !== '' && continues(line)) {
        if (impact_field === 'Decision') decision = `${decision} ${trim(line)}`;
        else worst = `${worst} ${trim(line)}`;
        prose_words += words(line);
        continue;
      }
      impact_field = '';
      if (trim(line) !== '' && worst_seen && !decision_seen) prose_since_worst = true;
    }
    if (section === 'Risk') {
      if (parse_label(line, 'Rollback')) { rollback_seen = true; rollback = parsed_rest; in_rollback = true; }
      else if (in_rollback && continues(line)) rollback = `${rollback} ${trim(line)}`;
      else in_rollback = false;
    }
    if (section !== '') body.set(section, `${get(body, section)} ${trim(line)}`);
    if (section === 'Risk' && /^[ \t]*\|/.test(line) && !/^[ \t]*\|[ \t:|-]*$/.test(line)) {
      const risk_cells = line.split('|');
      const area = trim(at(risk_cells, 1)), level = trim(at(risk_cells, 2)), consequence = trim(at(risk_cells, 3));
      if (area !== '' && level !== '' && consequence !== '') {
        if (lower(area) === 'area' && lower(level) === 'risk') risk_header = true;
        else risk_rows++;
      }
    }
    if (section === 'Verification' || section === 'Verification plan') {
      if (/^[ \t]*[-*] [^ ]/.test(line)) { verification_items++; ver_n++; ver_item[ver_n] = line; in_item = true; }
      else if (in_item && trim(line) !== '') ver_item[ver_n] = `${ver_item[ver_n]} ${trim(line)}`;
      else in_item = false;
    }
    if (!/^[ \t]*\|/.test(line)) prose_words += words(line);
  }
  if (fence !== '') fail('code fence is not closed');
  if (in_details) fail('<details> is not closed; add </details> before the end marker');
  if (kind === 'pr' && details_seen === 0) fail('missing <details>; Why, Risk, and Verification go inside <details><summary>Why, risk, verification</summary>');

  const declared = position.has('Risk') ? level_of(risk_heading) : '';
  const effective = max_rank(rank(floor), rank(declared));

  const required = kind === 'plan' ? ['Plan', 'Risk', 'Verification plan'] : ['Impact', 'Why', 'Risk', 'Verification'];
  let previous = 0;
  for (const name of required) {
    if (!position.has(name)) { fail(`missing section '## ${name === 'Risk' ? 'Risk: <level>' : name}'`); continue; }
    if (position.get(name) < previous) fail(`section '${name}' is out of order; required order is ${kind === 'plan' ? 'Plan, Risk, Verification plan' : 'Impact, Why, Risk, Verification'}`);
    previous = position.get(name);
  }
  const lead_name = kind === 'plan' ? 'Plan' : 'Impact';
  if (position.has(lead_name) && position.get(lead_name) !== 1) fail(`first section must be '## ${lead_name}'`);
  for (const name of position.keys()) if (trim(get(body, name)) === '') fail(`section '${name}' is empty; omit optional sections instead`);
  if (prose_words > 200) fail(`recap has ${prose_words} words outside tables, code, diagrams, and HTML tag lines; limit is 200, aim for 120`);
  if (position.has('Risk') && kind === 'pr' && (!risk_header || risk_rows < 1)) fail('## Risk: needs a table with a header and at least one area row');
  if (verification_items < 1) fail(`## ${kind === 'plan' ? 'Verification plan' : 'Verification'} needs at least one '- ' item: a check and its result, or 'Not verified: ...'`);
  if (position.has('Impact map') && map_count === 0) fail('impact map: ## Impact map needs a fenced diagram (```text ASCII by default)');
  if (map_count > 0) { if (map_mermaid) check_mermaid(); else check_map(); }
  else if (kind === 'pr' && rank(floor) >= 2) fail(`impact map: missing; at ${floor} risk add '## Impact map' with an ASCII diagram right after Impact`);
  if (position.has('Impact map') && position.get('Impact map') !== 2) fail(`## Impact map must come directly after ## ${lead_name}`);
  if (position.has(lead_name)) check_impact(`## ${lead_name}`, get(body, lead_name));
  if (position.has('Risk')) check_level('## Risk:', risk_heading);

  if (kind === 'pr') {
    for (const name of position.keys()) {
      if (details_seen === 0) break;
      if ((name === 'Impact' || name === 'Impact map') && inside.get(name)) fail(`section '${name}' belongs above <details>, where the reader sees it first`);
      if (name !== 'Impact' && name !== 'Impact map' && !inside.get(name)) fail(`section '${name}' belongs inside <details>; only Impact and Impact map stay visible`);
    }
    if (worst_seen) check_label_words('Worst case:', worst, 20);
    else if (effective >= 2) fail(`Worst case: is required at ${effective >= 3 ? 'high' : 'medium'} risk; add a 'Worst case:' line directly before Decision:`);
    if (worst_seen && decision_seen && (worst_order > decision_order || prose_since_worst)) fail('Worst case: must come directly before Decision:');
    if (decision_seen) { check_label_words('Decision:', decision, 25); check_not_none('Decision:', decision, effective); }
    else if (effective >= 2) fail(`Decision: is required at ${effective >= 3 ? 'high' : 'medium'} risk; add a 'Decision:' line to ## Impact (what the reviewer must decide before merge)`);
    if (effective >= 3) {
      if (rollback_seen) check_rollback('Rollback:', rollback);
      else fail('Rollback: is required at high risk; add a \'Rollback:\' line to ## Risk');
      for (let i = 1; i <= ver_n; i++) check_not_verified(`Verification item ${i}`, ver_item[i]);
    }
    check_invariants('## Risk', get(body, 'Risk'));
  }
}

lint();
let status = failures > 0 ? 1 : 0;

// ---- end of checks ----

// Find a command on PATH; on Windows try only the PATHEXT extensions.
function which(command) {
  const windows = process.platform === 'win32';
  const exts = windows ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (!windows) fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* not here */ }
    }
  }
  return '';
}

// Optional: parse a mermaid impact map with mmdc when it is installed.
const mmdc = kind === 'pr' ? which('mmdc') : '';
if (mmdc) {
  // Lines after a ```mermaid fence up to the next fence, CRs removed.
  // A repeated ```mermaid line restarts nothing; it is skipped.
  const plain = text.replace(/\r/g, '');
  const rows = plain.split('\n');
  if (plain.endsWith('\n')) rows.pop();
  let map = '';
  let on = false;
  for (const line of rows) {
    if (/^[ \t]*```mermaid/.test(line)) { on = true; continue; }
    if (on && /^[ \t]*```/.test(line)) break;
    if (on) map += `${line}\n`;
  }
  if (map !== '') {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'so-what-lint-'));
    try {
      const input = path.join(work, 'map.mmd');
      const output = path.join(work, 'mmdc.out');
      fs.writeFileSync(input, Buffer.from(map, 'latin1'));
      const svg = path.join(work, 'map.svg');
      // Windows runs mmdc.cmd through the shell as one quoted command line.
      const fd = fs.openSync(output, 'w');
      let result;
      try {
        result = process.platform === 'win32'
          ? spawnSync(`"${mmdc}" -q -i "${input}" -o "${svg}"`, { stdio: ['ignore', fd, fd], timeout: 20000, shell: true })
          : spawnSync('mmdc', ['-q', '-i', input, '-o', svg], { stdio: ['ignore', fd, fd], timeout: 20000 });
      } finally {
        fs.closeSync(fd);
      }
      const log = fs.readFileSync(output).toString('latin1');
      const timedOut = result.error && result.error.code === 'ETIMEDOUT';
      const failed = timedOut || result.error || result.status !== 0;
      if (timedOut || (failed && /launch|puppeteer|browser|chrom/i.test(log))) {
        err(`lint.mjs: mmdc could not run here (timeout or no browser); mermaid parse check skipped\n`);
      } else if (failed) {
        status = 1;
        process.exitCode = 1;
        out(`${FILENAME}: impact map: mmdc could not parse the mermaid diagram\n`);
        // Indent each mmdc output line by 4 spaces, like sed 's/^/    /'.
        const logLines = log.split('\n');
        if (log.endsWith('\n')) logLines.pop();
        out(logLines.map((line) => `    ${line}`).join('\n') + (log.endsWith('\n') ? '\n' : ''));
      }
    } finally {
      // Windows can hold a file after a timeout (EBUSY); a leftover temp dir is harmless.
      try {
        fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
      } catch { /* leave it */ }
    }
  }
}

if (status !== 0) process.exit(1);
out(`lint.mjs: ${kind} ok\n`);
