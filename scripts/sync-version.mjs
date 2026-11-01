#!/usr/bin/env node
// Write one release version into every manifest that carries a version.
// semantic-release calls this in its prepare step: node scripts/sync-version.mjs 1.2.3
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  console.error(`sync-version: invalid version "${version}"`);
  process.exit(1);
}

for (const file of ["package.json", ".claude-plugin/plugin.json"]) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`sync-version: ${file} -> ${version}`);
}
