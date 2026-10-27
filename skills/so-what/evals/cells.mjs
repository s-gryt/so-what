#!/usr/bin/env node
// List generated outputs in a run dir, one per line:
//   cells.mjs <run-dir> [case]    arm<TAB>case<TAB>rN<TAB>path-to-out.txt
// Layout is <run>/<arm>/<case>/r<N>/out.txt. The older <run>/<arm>/<case>/out.txt
// counts as r1 when no r1 exists.
import { prog, die, isDir, listCells } from './lib.mjs';

const args = process.argv.slice(2);
if (args.length < 1 || !isDir(args[0])) die(`usage: ${prog()} <run-dir> [case]`, 2);
process.stdout.write(listCells(args[0], args[1] || '').map((c) => c.join('\t') + '\n').join(''));
