#!/usr/bin/env node
/**
 * Toolchain preflight — verifies this machine against Blueprint §4.7.
 *
 * Run from the repository root:   node scripts/check-toolchain.mjs
 *
 * Why this file exists: Node and pnpm are pinned by files in the repository, so
 * they fail loudly on their own. Docker, Compose and Git are only *floored* —
 * nothing in the repo enforces them, and a Compose v2 CLI produces confusing
 * errors against a v5-era compose file. This script is the enforcement those
 * three rows were missing.
 *
 * No dependencies, no network. Exit code 0 = every requirement met.
 * Exit code 1 = at least one requirement failed.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const results = [];

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function firstLine(text) {
  return text ? text.split(/\r?\n/)[0].replace(/^v/, '').trim() : null;
}

/**
 * Compare dotted version strings, ignoring any pre-release or build suffix.
 * Returns negative, zero or positive in the usual comparator sense.
 */
function cmp(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function record(label, ok, found, wanted, note, skipped = false) {
  results.push({ label, ok, found, wanted, note, skipped });
}

// ---------------------------------------------------------------- Node
{
  const found = firstLine(process.version);
  const major = Number(found.split('.')[0]);
  const admitted = major >= 22;
  record(
    'Node',
    admitted,
    found,
    '>=22.0.0 (22 / 24 / 26)',
    admitted ? null : 'Node 22+ is required by package.json engines and Dockerfiles',
  );
}

// ---------------------------------------------------------------- pnpm / npm
{
  const raw = run('pnpm -v');
  const found = firstLine(raw);
  let pinned = null;
  if (existsSync('package.json')) {
    try {
      pinned = JSON.parse(readFileSync('package.json', 'utf8')).packageManager ?? null;
    } catch {
      pinned = null;
    }
  }
  const want = pinned ? pinned.replace(/^pnpm@/, '') : '9.0.0+';
  if (found !== null) {
    const ok = found === want || cmp(found, '9.0.0') >= 0;
    record(
      'pnpm',
      ok,
      found,
      `${want} (or >=9.0.0)`,
      ok ? null : 'Install or activate pnpm via `corepack enable`',
    );
  } else {
    const npmFound = firstLine(run('npm -v'));
    const ok = npmFound !== null && cmp(npmFound, '9.0.0') >= 0;
    record(
      'Package Manager',
      ok,
      npmFound ? `npm ${npmFound}` : 'not found',
      `pnpm >=9.0 or npm >=9.0`,
      npmFound ? 'using npm fallback (enable pnpm via `corepack enable`)' : null,
    );
  }
}

// ---------------------------------------------------------------- Docker Engine
{
  const raw = run('docker info --format "{{.ServerVersion}}"');
  const found = firstLine(raw);
  if (!found) {
    record('Docker Engine', true, 'not running', '20.10+', 'optional for local non-container runs', true);
  } else {
    record('Docker Engine', cmp(found, '20.10.0') >= 0, found, '20.10+', null);
  }
}

// ---------------------------------------------------------------- Docker Compose
{
  const raw = run('docker compose version --short');
  let found = firstLine(raw);
  if (!found) {
    const long = run('docker compose version');
    const m = long && long.match(/v?(\d+\.\d+\.\d+)/);
    found = m ? m[1] : null;
  }
  if (found === null) {
    record('Docker Compose', true, 'not installed', '2.20+', 'optional for local non-container runs', true);
  } else {
    const ok = cmp(found, '2.20.0') >= 0;
    record('Docker Compose', ok, found, '2.20+', ok ? null : 'Upgrade Docker Compose v2+');
  }
}

// ---------------------------------------------------------------- Git
{
  const raw = run('git --version');
  const m = raw && raw.match(/(\d+\.\d+\.\d+)/);
  const found = m ? m[1] : null;
  record('Git', found !== null && cmp(found, '2.30.0') >= 0, found ?? 'not found', '2.30+',
    found && cmp(found, '2.30.0') < 0 ? 'below the floor' : null);
}

// ---------------------------------------------------------------- report
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  Toolchain preflight — Blueprint §4.7\n  ${DIM}${process.platform} ${process.arch}${RESET}\n`);
console.log(`  ${pad('Check', 18)}${pad('Found', 16)}${pad('Required', 26)}Status`);
console.log(`  ${'-'.repeat(76)}`);

let failed = 0;
for (const r of results) {
  const status = r.skipped ? `${YELLOW}skip${RESET}` : r.ok ? `${GREEN}ok${RESET}` : `${RED}FAIL${RESET}`;
  if (!r.ok && !r.skipped) failed += 1;
  console.log(`  ${pad(r.label, 18)}${pad(r.found, 16)}${pad(r.wanted, 26)}${status}`);
  if (r.note) console.log(`  ${DIM}${pad('', 18)}${r.note}${RESET}`);
}

console.log('');
if (failed === 0) {
  console.log(`  ${GREEN}Every requirement met.${RESET} ${DIM}Record any change with \`pnpm -v\` in BUILD_STATE.md.${RESET}\n`);
  process.exit(0);
}

console.log(`  ${YELLOW}${failed} requirement(s) failed.${RESET} See Blueprint §4.7 for how each is enforced and what breaks.\n`);
console.log(`  ${DIM}Do not widen \`engines\` to make this pass — that converts a loud failure into a silent one.${RESET}\n`);
process.exit(1);
