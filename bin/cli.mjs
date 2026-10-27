#!/usr/bin/env node
// Installs the so-what skill (and sw commit / sw pr slash commands) for Claude Code,
// Codex, GitHub Copilot, and Antigravity. No dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'so-what';
const DESCRIPTIONS = {
  commit: 'Write an impact-first commit message with an ASCII impact map for the staged changes',
  pr: 'Write an impact-first pull request description with an ASCII impact map for this branch',
};
const ARG_HINTS = { commit: '', pr: '[number]' };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillSrc = path.join(root, 'skills', NAME);
const COMMANDS = Object.keys(DESCRIPTIONS);
const commandBody = Object.fromEntries(COMMANDS.map((c) => [c, fs.readFileSync(path.join(root, 'commands', `${c}.md`), 'utf8')]));
const home = os.homedir();

// Each agent: where skills live per scope, how its slash command is shaped,
// and which paths mean "this agent is in use" for auto-detection.
const AGENTS = {
  claude: {
    label: 'Claude Code',
    skills: { project: '.claude/skills', global: path.join(home, '.claude/skills') },
    command: {
      project: (c) => `.claude/commands/sw/${c}.md`,
      global: (c) => path.join(home, `.claude/commands/sw/${c}.md`),
      render: (c, b) => `---\ndescription: ${DESCRIPTIONS[c]}\nargument-hint: "${ARG_HINTS[c]}"\n---\n\n${b.replace('{{ARGS}}', ' Argument: `$ARGUMENTS`')}`,
    },
    detect: { project: ['.claude', 'CLAUDE.md'], global: [path.join(home, '.claude')] },
  },
  codex: {
    label: 'Codex',
    skills: { project: '.agents/skills', global: path.join(home, '.agents/skills') },
    command: {
      global: (c) => path.join(home, `.codex/prompts/sw-${c}.md`),
      render: (c, b) => `---\ndescription: ${DESCRIPTIONS[c]}\nargument-hint: ARGS\n---\n\n${b.replace('{{ARGS}}', ' Argument: `$ARGUMENTS`')}`,
    },
    detect: { project: ['.codex', '.agents'], global: [path.join(home, '.codex')] },
  },
  copilot: {
    label: 'GitHub Copilot',
    skills: { project: '.github/skills', global: path.join(home, '.copilot/skills') },
    command: {
      project: (c) => `.github/prompts/sw-${c}.prompt.md`,
      render: (c, b) => `---\nmode: agent\ndescription: ${DESCRIPTIONS[c]}\n---\n\n${b.replace('{{ARGS}}', '')}`,
    },
    detect: {
      project: ['.github/copilot-instructions.md', '.github/skills', '.github/prompts'],
      global: [path.join(home, '.copilot')],
    },
  },
  antigravity: {
    label: 'Antigravity',
    skills: { project: '.agent/skills', global: path.join(home, '.gemini/antigravity/skills') },
    command: {
      project: (c) => `.agent/workflows/sw-${c}.md`,
      global: (c) => path.join(home, `.gemini/antigravity/global_workflows/sw-${c}.md`),
      render: (c, b) => `---\ndescription: ${DESCRIPTIONS[c]}\n---\n\n${b.replace('{{ARGS}}', '')}`,
    },
    detect: { project: ['.agent', '.gemini'], global: [path.join(home, '.gemini/antigravity')] },
  },
};

const HELP = `so-what: impact-first commit and pull request descriptions with an ASCII impact map

usage:
  npx so-what [add] [options]    install the skill and slash command
  npx so-what list               show install targets and what is installed

options:
  -a, --agent <list>   claude, codex, copilot, antigravity (comma-separated) or all
                       default: agents detected in the target
  -g, --global         install for the current user instead of the project
  -d, --dir <path>     project directory (default: current directory)
      --no-command     install the skill only, no slash command
  -f, --force          overwrite an existing install
  -n, --dry-run        print what would change, write nothing
  -h, --help           show this help

examples:
  npx so-what --agent all
  npx so-what -g -a claude,codex
`;

function parse(argv) {
  const o = { cmd: 'add', agents: null, global: false, dir: process.cwd(), command: true, force: false, dry: false };
  const rest = [...argv];
  if (rest[0] === 'add' || rest[0] === 'list') o.cmd = rest.shift();
  while (rest.length) {
    const a = rest.shift();
    const val = () => {
      if (!rest.length) fail(`${a} needs a value`);
      return rest.shift();
    };
    if (a === '-a' || a === '--agent') o.agents = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '-g' || a === '--global') o.global = true;
    else if (a === '-d' || a === '--dir') o.dir = path.resolve(val());
    else if (a === '--no-command') o.command = false;
    else if (a === '-f' || a === '--force') o.force = true;
    else if (a === '-n' || a === '--dry-run') o.dry = true;
    else if (a === '-h' || a === '--help') { process.stdout.write(HELP); process.exit(0); }
    else fail(`unknown argument: ${a}`);
  }
  return o;
}

function fail(msg) {
  process.stderr.write(`so-what: ${msg}\n`);
  process.exit(2);
}

const abs = (o, p) => (path.isAbsolute(p) ? p : path.join(o.dir, p));
const scopeOf = (o) => (o.global ? 'global' : 'project');

function pickAgents(o) {
  if (o.agents) {
    const names = o.agents.includes('all') ? Object.keys(AGENTS) : o.agents;
    for (const n of names) if (!AGENTS[n]) fail(`unknown agent "${n}"; choose from ${Object.keys(AGENTS).join(', ')}, all`);
    return names;
  }
  const found = Object.keys(AGENTS).filter((n) =>
    AGENTS[n].detect[scopeOf(o)].some((p) => fs.existsSync(abs(o, p))));
  if (!found.length) fail('no agent detected here; pass --agent claude,codex,copilot,antigravity or --agent all');
  return found;
}

const shouldCopy = (src) => path.basename(src) !== 'evals' && path.basename(src) !== '.omc';

function installSkill(o, name, log) {
  const dest = path.join(abs(o, AGENTS[name].skills[scopeOf(o)]), NAME);
  if (fs.existsSync(dest) && !o.force) return log(name, 'skill', dest, 'exists (use --force)');
  if (!o.dry) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(skillSrc, dest, { recursive: true, filter: shouldCopy });
  }
  log(name, 'skill', dest, o.dry ? 'would install' : 'installed');
}

function installCommand(o, name, log) {
  const cmd = AGENTS[name].command;
  const target = cmd[scopeOf(o)];
  if (!target) return log(name, 'command', '-', `no ${scopeOf(o)}-scope slash command for ${AGENTS[name].label}`);
  for (const c of COMMANDS) {
    const dest = abs(o, target(c));
    if (fs.existsSync(dest) && !o.force) { log(name, 'command', dest, 'exists (use --force)'); continue; }
    if (!o.dry) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, cmd.render(c, commandBody[c]));
    }
    log(name, 'command', dest, o.dry ? 'would write' : 'written');
  }
}

function list(o) {
  for (const scope of ['project', 'global']) {
    const so = { ...o, global: scope === 'global' };
    process.stdout.write(`${scope}:\n`);
    for (const [name, a] of Object.entries(AGENTS)) {
      const skill = path.join(abs(so, a.skills[scope]), NAME);
      const mark = (p) => (p && fs.existsSync(p) ? 'installed' : 'absent');
      process.stdout.write(`  ${name.padEnd(12)} skill ${mark(skill).padEnd(9)} ${skill}\n`);
      for (const c of COMMANDS) {
        const cmd = a.command[scope] ? abs(so, a.command[scope](c)) : null;
        process.stdout.write(`  ${''.padEnd(12)} ${('sw:' + c).padEnd(10)}${cmd ? mark(cmd).padEnd(9) + ' ' + cmd : 'n/a'}\n`);
      }
    }
  }
}

const o = parse(process.argv.slice(2));
if (!fs.existsSync(path.join(skillSrc, 'SKILL.md'))) fail(`skill source missing at ${skillSrc}`);
if (o.cmd === 'list') { list(o); process.exit(0); }

const log = (agent, kind, where, status) => process.stdout.write(`${AGENTS[agent].label.padEnd(15)} ${kind.padEnd(8)} ${status.padEnd(22)} ${where}\n`);
for (const name of pickAgents(o)) {
  installSkill(o, name, log);
  if (o.command) installCommand(o, name, log);
}
if (!o.dry) process.stdout.write('\nDone. Invoke /sw:commit or /sw:pr (Codex, Copilot, Antigravity: sw-commit, sw-pr), or just ask it to write a commit message or PR description.\n');
