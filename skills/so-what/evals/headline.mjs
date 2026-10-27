#!/usr/bin/env node
// Extract the headline view of one output: the part that carries the whole message.
//   headline.mjs <file>
// Prints, in order, whichever exist:
//   Title:       first non-blank line (HTML comment lines skipped); for a PR
//                body (it has `## Impact`) there is no title, so it says so
//   Impact:      first sentence of the PR `## Impact` section, of the commit
//                `Impact:` line, or (free-form text) of the first paragraph
//                after the first line
//   Worst case:  PR `Worst case:` line
//   Risk:        commit `Risk:` line, first sentence (none for free-form text)
//   Decision: / Needs:  first such line
//   Map:         first ```text or ```mermaid fence, or any fence directly under
//                `## Impact map`; else the first run of 4-space-indented lines
//                holding an arrow (-->, ==>, ->) or a [node]
// Labels may be bold (**Decision:**); wrapped lines are joined up to a blank
// line, another label line, a heading or a fence.
import fs from 'node:fs';
import { prog, die, isFile, readBytes, headline } from './lib.mjs';

const args = process.argv.slice(2);
let ok = args.length === 1 && isFile(args[0]);
if (ok) {
  try {
    fs.accessSync(args[0], fs.constants.R_OK);
  } catch {
    ok = false;
  }
}
if (!ok) die(`usage: ${prog()} <file>`, 2);
process.stdout.write(Buffer.from(headline(readBytes(args[0])), 'latin1'));
