#!/usr/bin/env node
/**
 * @file scripts/build-workspaces.mjs
 * @description Topological Workspace Compiler for Kartik.ai Monorepo.
 *
 * Compiles `@kartik/shared` first followed by all dependent services and `@kartik/frontend`
 * so cross-workspace declaration files (`dist/*.d.ts`) are always fresh before downstream compilation.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_LINKS = [
  ['@kartik/shared', 'backend/shared'],
  ['@kartik/auth', 'backend/services/auth'],
  ['@kartik/gateway', 'backend/gateway'],
  ['@kartik/billing', 'backend/services/billing'],
  ['@kartik/agent', 'backend/services/agent'],
  ['@kartik/chat', 'backend/services/chat'],
  ['@kartik/frontend', 'frontend'],
];

const scopeDir = path.resolve('node_modules/@kartik');
fs.mkdirSync(scopeDir, { recursive: true });
for (const [pkgName, relTarget] of WORKSPACE_LINKS) {
  const pkgShort = pkgName.split('/')[1];
  const linkPath = path.join(scopeDir, pkgShort);
  const absTarget = path.resolve(relTarget);
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  } catch {
    // Link does not exist yet
  }
  fs.symlinkSync(absTarget, linkPath, 'dir');
}

const WORKSPACES_IN_ORDER = [
  'backend/shared',
  'backend/services/auth',
  'backend/gateway',
  'backend/services/billing',
  'backend/services/agent',
  'backend/services/chat',
  'frontend',
];

for (const ws of WORKSPACES_IN_ORDER) {
  const tsconfigPath = path.join(ws, 'tsconfig.json');
  execSync(`npx tsc -p ${tsconfigPath}`, { stdio: 'inherit' });
  if (ws === 'frontend') {
    execSync('npx vite build --config frontend/vite.config.ts', { stdio: 'inherit' });
  }
}

