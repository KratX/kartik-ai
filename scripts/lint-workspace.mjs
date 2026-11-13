#!/usr/bin/env node
/**
 * @file scripts/lint-workspace.mjs
 * @description Production SaaS Static Code Quality & Architectural Boundary Linter.
 *
 * Enforces 6 strict architectural, security, and TypeScript quality rules across workspaces:
 * 1. `no-ts-suppression-directives`: Forbids `@ts-ignore` and `@ts-nocheck` in `.ts`/`.tsx` files.
 * 2. `no-explicit-any`: Forbids explicit `: any`, `<any>`, or `as any` type escapes in workspace source files.
 * 3. `no-cross-service-imports` (Blueprint Invariant #7): Services (`auth`, `chat`, `agent`, `billing`, `gateway`)
 *    must never import internal modules from another backend service (`services/auth`, `services/chat`, etc.).
 * 4. `no-frontend-backend-leak` (Blueprint Invariants #1 & #14): `frontend/src` must never import backend
 *    service implementations (`backend/services/*` or `backend/gateway/*`).
 * 5. `no-unsafe-sandbox-origin` (Blueprint Invariant #11): Sandboxed code preview iframes must never enable
 *    `allow-same-origin` alongside `allow-scripts`.
 * 6. `no-hardcoded-live-secrets` (Blueprint §11): Rejects live API key prefixes (`AIzaSy`, `sk-live-`) in source files.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Recursively collects `.ts` and `.tsx` files under `dir`, skipping `dist` and `node_modules`.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function collectSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === '.git'
    ) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Runs all static lint rules against a workspace or repository directory.
 *
 * @param {string} targetDir
 * @returns {{ filesChecked: number; violations: Array<{ file: string; line: number; rule: string; message: string }> }}
 */
export function lintDirectory(targetDir) {
  const absTarget = path.resolve(targetDir);
  const files = collectSourceFiles(absTarget);
  /** @type {Array<{ file: string; line: number; rule: string; message: string }>} */
  const violations = [];

  for (const filePath of files) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const isTestFile = normalizedPath.includes('/tests/') || normalizedPath.endsWith('.test.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const lineNum = i + 1;
      const trimmed = line.trim();

      // Skip pure comment lines for code token checks (except @ts-ignore/@ts-nocheck)
      if (/@ts-ignore|@ts-nocheck/.test(line)) {
        violations.push({
          file: normalizedPath,
          line: lineNum,
          rule: 'no-ts-suppression-directives',
          message: 'TypeScript suppression directives (@ts-ignore / @ts-nocheck) are forbidden.',
        });
      }

      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      // Rule 2: no-explicit-any in production source files
      if (!isTestFile && /(?:\b:\s*any\b|\bas\s+any\b|<any>)/.test(line)) {
        violations.push({
          file: normalizedPath,
          line: lineNum,
          rule: 'no-explicit-any',
          message: 'Explicit "any" type escape is forbidden in production source files.',
        });
      }

      // Rule 3: no-cross-service-imports (Blueprint Invariant #7)
      const serviceMatch = normalizedPath.match(/\/backend\/services\/(auth|chat|agent|billing)\//);
      if (serviceMatch && /^\s*import\s/.test(line)) {
        const currentService = serviceMatch[1];
        for (const otherService of ['auth', 'chat', 'agent', 'billing', 'gateway']) {
          if (
            otherService !== currentService &&
            new RegExp(`services/${otherService}|backend/gateway`).test(line)
          ) {
            violations.push({
              file: normalizedPath,
              line: lineNum,
              rule: 'no-cross-service-imports',
              message: `Service "${currentService}" must not import directly from "${otherService}" (Invariant #7).`,
            });
          }
        }
      }

      // Rule 4: no-frontend-backend-leak (Blueprint Invariants #1 & #14)
      if (normalizedPath.includes('/frontend/src/') && /^\s*import\s/.test(line)) {
        if (/backend\/services\/|backend\/gateway\//.test(line)) {
          violations.push({
            file: normalizedPath,
            line: lineNum,
            rule: 'no-frontend-backend-leak',
            message: 'Frontend workspace must not import backend service implementations directly (Invariant #1).',
          });
        }
      }

      // Rule 5: no-unsafe-sandbox-origin (Blueprint Invariant #11)
      if (
        !isTestFile &&
        /sandbox\s*=\s*["'][^"']*allow-scripts[^"']*allow-same-origin/.test(line)
      ) {
        violations.push({
          file: normalizedPath,
          line: lineNum,
          rule: 'no-unsafe-sandbox-origin',
          message: 'Sandboxed iframe must never combine allow-scripts with allow-same-origin (Invariant #11).',
        });
      }

      // Rule 6: no-hardcoded-live-secrets (Blueprint §11)
      if (!isTestFile && /(?:AIzaSy[A-Za-z0-9_-]{20,}|sk-live-[A-Za-z0-9]{16,}|rzp_live_[A-Za-z0-9]{8,})/.test(line)) {
        violations.push({
          file: normalizedPath,
          line: lineNum,
          rule: 'no-hardcoded-live-secrets',
          message: 'Hardcoded live API or payment keys are forbidden in source files (Blueprint §11).',
        });
      }
    }
  }

  return {
    filesChecked: files.length,
    violations,
  };
}

const isMain =
  process.argv[1] && process.argv[1].endsWith('lint-workspace.mjs');

if (isMain) {
  const targetArg = process.argv[2] ?? '.';
  const result = lintDirectory(targetArg);
  if (result.violations.length > 0) {
    for (const v of result.violations) {
      console.error(`[lint] ERROR (${v.rule}) ${v.file}:${v.line} — ${v.message}`);
    }
    process.exit(1);
  }
  console.log(
    `[lint] Checked ${result.filesChecked} TypeScript source files in "${path.basename(path.resolve(targetArg))}" — 0 architectural or code-quality violations.`,
  );
}
