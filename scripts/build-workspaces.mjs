#!/usr/bin/env node
/**
 * @file scripts/build-workspaces.mjs
 * @description Topological Workspace Compiler for Kartik.ai Monorepo.
 *
 * Compiles `@kartik/shared` first followed by all dependent services and `@kartik/frontend`
 * so cross-workspace declaration files (`dist/*.d.ts`) are always fresh before downstream compilation.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';

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
}
