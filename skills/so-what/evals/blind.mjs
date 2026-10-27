#!/usr/bin/env node
// Shuffle every arm's output for one case and run into blind labels X1..Xn.
//   blind.mjs <run-dir> <case> [rN]     all runs of the case, or one
// Older skill versions' `impact-recap:` marker is shown as `so-what:`, as in score.mjs.
// Per run writes
//   <run>/blind/<case>.rN.md           outputs only, labeled
//   <run>/blind/<case>.rN.headline.md  headline view of each, same labels and order
//   <run>/blind/<case>.rN.key          label<TAB>arm (never shown to the judge)
// The order is a seeded shuffle: the same case and run always give the same labels.
import { prog, die, isDir, blind } from './lib.mjs';

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3 || !isDir(args[0])) die(`usage: ${prog()} <run-dir> <case> [rN]`, 2);
process.stdout.write(blind(args[0], args[1], args[2]).map((l) => l + '\n').join(''));
