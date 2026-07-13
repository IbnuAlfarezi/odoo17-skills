#!/usr/bin/env node
'use strict';

/**
 * Installer for the "odoo17-skills" Agent Skill.
 *
 * Copies (or symlinks) this repo's SKILL.md + references/ into whichever AI
 * coding tool's skills directory you point it at. No dependencies — plain
 * Node so it works via `node install.js`, a local `npx .`, or `npx
 * github:<user>/<repo>` without anyone having to publish anything to npm.
 *
 * Usage:
 *   node install.js --<tool> [--global] [--symlink]
 *   node install.js --path <custom-directory> [--symlink]
 *   node install.js --list
 *   node install.js --help
 *
 * Run `node install.js --list` to see every path this script knows about,
 * how confident that path is, and where --global falls back to project-only
 * for tools (like Cursor) that don't have a personal skills directory.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL_NAME = 'odoo17-skills';
const REPO_ROOT = __dirname;
const SKILL_ENTRIES = ['SKILL.md', 'references']; // only the skill payload — not README/LICENSE/this script
const HOME = os.homedir();
const CWD = process.cwd();

// confidence: 'confirmed' = checked against official docs and/or multiple
// corroborating sources as of mid-2026. 'best-effort' = single source, or a
// fast-moving/young product whose conventions may already have shifted —
// verify locally before relying on it. Tools I found no reliable source for
// at all (however you got here from a table that listed more of them) are
// intentionally left out rather than guessed at; use --path for those.
const TARGETS = {
  'claude-code': {
    label: 'Claude Code',
    personal: () => path.join(HOME, '.claude', 'skills', SKILL_NAME),
    project: () => path.join(CWD, '.claude', 'skills', SKILL_NAME),
    firstUse: '/odoo17-skills review this model for anti-patterns',
    confidence: 'confirmed',
  },
  antigravity: {
    label: 'Google Antigravity (IDE & CLI)',
    personal: () => path.join(HOME, '.gemini', 'config', 'skills', SKILL_NAME),
    project: () => path.join(CWD, '.agents', 'skills', SKILL_NAME),
    firstUse: 'Use @odoo17-skills to review this module',
    confidence: 'confirmed',
    note: "Antigravity's skills path has already moved more than once since its Nov 2025 launch — check Settings \u2192 Skills for the current path if this isn't picked up.",
  },
  cursor: {
    label: 'Cursor',
    project: () => path.join(CWD, '.cursor', 'skills', SKILL_NAME),
    firstUse: '@odoo17-skills review this model',
    confidence: 'confirmed',
    note: 'Cursor is project-scoped only (no personal/global skills directory) — --global is ignored for this tool.',
  },
  codex: {
    label: 'OpenAI Codex CLI',
    personal: () => path.join(HOME, '.codex', 'skills', SKILL_NAME),
    project: () => path.join(CWD, '.codex', 'skills', SKILL_NAME),
    firstUse: 'Use odoo17-skills to review this module',
    confidence: 'confirmed',
  },
  kiro: {
    label: 'Kiro CLI',
    personal: () => path.join(HOME, '.kiro', 'skills', SKILL_NAME),
    project: () => path.join(CWD, '.kiro', 'skills', SKILL_NAME),
    firstUse: 'Use odoo17-skills to review this module',
    confidence: 'confirmed',
  },
  'gemini-cli': {
    label: 'Gemini CLI',
    personal: () => path.join(HOME, '.gemini', 'skills', SKILL_NAME),
    firstUse: 'Use odoo17-skills to review this module',
    confidence: 'best-effort',
    note: "Single-source-verified, and distinct from Antigravity's ~/.gemini/config/skills/ \u2014 confirm against Gemini CLI's current docs.",
  },
  opencode: {
    label: 'OpenCode',
    project: () => path.join(CWD, '.agents', 'skills', SKILL_NAME),
    firstUse: 'opencode run @odoo17-skills review this model',
    confidence: 'best-effort',
    note: "OpenCode's skill location is configurable (skill.paths in its own config). .agents/skills/ is the emerging cross-tool default, not a confirmed OpenCode-specific one \u2014 check your opencode config if this isn't picked up.",
  },
  copilot: {
    label: 'GitHub Copilot',
    manualOnly: true,
    firstUse: 'Ask Copilot to use odoo17-skills to review this module',
    note: 'No standard skills folder found for Copilot \u2014 paste SKILL.md content into your Copilot instructions, or reference it manually in chat.',
  },
};

function printHelp() {
  console.log(`
${SKILL_NAME} installer

Usage:
  node install.js --<tool> [--global] [--symlink]
  node install.js --path <custom-directory> [--symlink]
  node install.js --list
  node install.js --help

Tools: ${Object.keys(TARGETS).filter((k) => !TARGETS[k].manualOnly).join(', ')}, copilot (manual, no folder)

Examples:
  node install.js --claude-code             # project-local (.claude/skills/)
  node install.js --claude-code --global    # personal      (~/.claude/skills/)
  node install.js --antigravity --global
  node install.js --path ./my-skills
  node install.js --claude-code --symlink   # symlink instead of copy, stays in sync with this repo
  node install.js --list                    # show every path this script knows, with confidence level
`);
}

function printList() {
  console.log('\nKnown install targets (\u2713 confirmed against official/multiple sources, ~ best-effort \u2014 verify locally, \u2013 manual/no folder):\n');
  for (const [flag, t] of Object.entries(TARGETS)) {
    const mark = t.manualOnly ? '\u2013' : t.confidence === 'confirmed' ? '\u2713' : '~';
    console.log(`  ${mark} --${flag.padEnd(12)} ${t.label}`);
    if (t.personal) console.log(`      personal: ${t.personal()}`);
    if (t.project) console.log(`      project:  ${t.project()}`);
    if (t.note) console.log(`      note: ${t.note}`);
  }
  console.log('\n  \u2713 --path <dir>       any custom location \u2014 always works, no tool-specific guesswork\n');
}

function copySkill(dest, { symlink }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of SKILL_ENTRIES) {
    const src = path.join(REPO_ROOT, entry);
    const target = path.join(dest, entry);
    if (!fs.existsSync(src)) {
      console.error(`  ! Missing ${entry} next to install.js \u2014 is this script still inside the repo?`);
      process.exit(1);
    }
    fs.rmSync(target, { recursive: true, force: true });
    if (symlink) {
      fs.symlinkSync(src, target, fs.statSync(src).isDirectory() ? 'dir' : 'file');
    } else {
      fs.cpSync(src, target, { recursive: true, dereference: true });
    }
  }
}

function resolveDest(args) {
  const useGlobal = args.includes('--global');
  const pathIdx = args.indexOf('--path');

  if (pathIdx !== -1) {
    const custom = args[pathIdx + 1];
    if (!custom) {
      console.error('--path requires a directory argument, e.g. --path ./my-skills');
      process.exit(1);
    }
    return { dest: path.join(path.resolve(custom), SKILL_NAME), toolInfo: null };
  }

  const flag = Object.keys(TARGETS).find((k) => args.includes(`--${k}`));
  if (!flag) {
    console.error('Unrecognized target. Run "node install.js --list" to see supported tools, or use --path <dir> for anything else.');
    process.exit(1);
  }

  const toolInfo = TARGETS[flag];
  if (toolInfo.manualOnly) {
    console.log(`\n${toolInfo.label} has no standard skills folder to install into.`);
    console.log(toolInfo.note);
    console.log(`\nFirst use once added:\n  ${toolInfo.firstUse}\n`);
    process.exit(0);
  }

  if (useGlobal && !toolInfo.personal) {
    console.log(`${toolInfo.label} has no personal/global skills directory \u2014 installing to the project instead.`);
  }
  const locFn = (useGlobal && toolInfo.personal) ? toolInfo.personal : (toolInfo.project || toolInfo.personal);
  return { dest: locFn(), toolInfo };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) return printHelp();
  if (args.includes('--list')) return printList();

  const useSymlink = args.includes('--symlink');
  const { dest, toolInfo } = resolveDest(args);

  console.log(`Installing ${SKILL_NAME}${useSymlink ? ' (symlink)' : ''} \u2192\n  ${dest}\n`);
  copySkill(dest, { symlink: useSymlink });
  console.log('Done.');

  if (toolInfo) {
    if (toolInfo.confidence === 'best-effort') {
      console.log(`\nNote: this path is best-effort${toolInfo.note ? ` (${toolInfo.note})` : ''}. Verify your tool actually picked it up before relying on it.`);
    } else if (toolInfo.note) {
      console.log(`\nNote: ${toolInfo.note}`);
    }
    console.log(`\nFirst use:\n  ${toolInfo.firstUse}\n`);
  }
}

main();
