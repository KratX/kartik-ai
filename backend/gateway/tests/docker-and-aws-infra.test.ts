/**
 * @file backend/gateway/tests/docker-and-aws-infra.test.ts
 * @description Phase 16 & Phase 18 Infrastructure Contract Verification (Micro-step 9.6.a).
 *
 * Verifies:
 * 1. All 6 root-context multi-stage `pnpm` Dockerfiles (`gateway`, `auth`, `chat`, `agent`,
 *    `billing`, `frontend`) exist, pin `pnpm@12.18.0`, enforce `--frozen-lockfile`, and expose
 *    the exact canonical ports (`8000`, `8001`, `8002`, `8003`, `8004`, `80`).
 * 2. Profile P `infra/aws/ec2-compose/docker-compose.prod.yml` exposes ONLY `frontend` (`80:80`)
 *    and keeps `gateway`, `auth`, `chat`, `agent`, `billing`, `redis`, and `qdrant` private on
 *    `kartik_internal` (Blueprint Invariants #1 & #14).
 * 3. Profile S `infra/aws/ecs-advanced/task-definitions.json` and
 *    `infra/aws/iam/least-privilege-policies.json` define Cloud Map `kartik.local` private service
 *    discovery and explicitly deny public S3 ACL modifications (Blueprint Invariant #10).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function findRepoRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

describe('Phase 16 & 18 Multi-Service Dockerfiles & AWS Infrastructure Contracts (9.6.a)', () => {
  const repoRoot = findRepoRoot();

  it('verifies all 6 root-context multi-stage Dockerfiles pin pnpm@12.18.0, use --frozen-lockfile, and expose canonical ports', () => {
    const expectedDockerfiles: ReadonlyArray<{
      readonly relPath: string;
      readonly port: number;
      readonly filterPkg: string;
      readonly requiresNonRootNodeUser: boolean;
      readonly expectedCmd?: string;
    }> = [
      {
        relPath: 'backend/gateway/Dockerfile',
        port: 8000,
        filterPkg: '@kartik/gateway',
        requiresNonRootNodeUser: true,
        expectedCmd: 'CMD ["node", "backend/gateway/dist/src/server/index.js"]',
      },
      {
        relPath: 'backend/services/auth/Dockerfile',
        port: 8001,
        filterPkg: '@kartik/auth',
        requiresNonRootNodeUser: true,
        expectedCmd: 'CMD ["node", "backend/services/auth/dist/src/server.js"]',
      },
      {
        relPath: 'backend/services/chat/Dockerfile',
        port: 8002,
        filterPkg: '@kartik/chat',
        requiresNonRootNodeUser: true,
        expectedCmd: 'CMD ["node", "backend/services/chat/dist/src/server.js"]',
      },
      {
        relPath: 'backend/services/agent/Dockerfile',
        port: 8003,
        filterPkg: '@kartik/agent',
        requiresNonRootNodeUser: true,
        expectedCmd: 'CMD ["node", "backend/services/agent/dist/src/server.js"]',
      },
      {
        relPath: 'backend/services/billing/Dockerfile',
        port: 8004,
        filterPkg: '@kartik/billing',
        requiresNonRootNodeUser: true,
        expectedCmd: 'CMD ["node", "backend/services/billing/dist/src/server.js"]',
      },
      {
        relPath: 'frontend/Dockerfile',
        port: 80,
        filterPkg: '@kartik/frontend',
        requiresNonRootNodeUser: false,
      },
    ];

    for (const item of expectedDockerfiles) {
      const fullPath = path.join(repoRoot, item.relPath);
      assert.ok(fs.existsSync(fullPath), `Missing Dockerfile: ${item.relPath}`);
      const content = fs.readFileSync(fullPath, 'utf8');

      assert.ok(
        content.includes('pnpm@12.18.0'),
        `${item.relPath} must pin pnpm@12.18.0`,
      );
      assert.ok(
        content.includes(
          `pnpm install --frozen-lockfile --filter . --filter @kartik/shared --filter ${item.filterPkg}`,
        ),
        `${item.relPath} must install root and filtered workspace dependencies with --frozen-lockfile --filter . --filter @kartik/shared --filter ${item.filterPkg}`,
      );
      assert.ok(
        content.includes(item.filterPkg),
        `${item.relPath} must build workspace package ${item.filterPkg}`,
      );
      assert.ok(
        content.includes(`EXPOSE ${item.port}`),
        `${item.relPath} must EXPOSE ${item.port}`,
      );
      if (item.requiresNonRootNodeUser) {
        assert.ok(
          content.includes('USER node'),
          `${item.relPath} must drop privileges to USER node`,
        );
      }
      if (item.expectedCmd) {
        assert.ok(
          content.includes(item.expectedCmd),
          `${item.relPath} must use executable server bootstrap CMD: ${item.expectedCmd}`,
        );
      }
    }
  });

  it('verifies Profile P docker-compose.prod.yml and Profile S ECS / IAM definitions enforce private service isolation and deny public S3 ACLs', () => {
    const composePath = path.join(
      repoRoot,
      'infra/aws/ec2-compose/docker-compose.prod.yml',
    );
    assert.ok(fs.existsSync(composePath));
    const composeContent = fs.readFileSync(composePath, 'utf8');
    assert.ok(composeContent.includes('"80:80"'));
    assert.ok(composeContent.includes('kartik_internal'));
    assert.ok(!composeContent.includes('"8001:8001"'));
    assert.ok(!composeContent.includes('"8002:8002"'));
    assert.ok(!composeContent.includes('"8003:8003"'));
    assert.ok(!composeContent.includes('"8004:8004"'));

    const ecsPath = path.join(
      repoRoot,
      'infra/aws/ecs-advanced/task-definitions.json',
    );
    assert.ok(fs.existsSync(ecsPath));
    const ecsJson = JSON.parse(fs.readFileSync(ecsPath, 'utf8')) as {
      cloudMapNamespace: {
        name: string;
        services: Record<string, string>;
      };
      taskDefinitions: Array<{ family: string }>;
    };
    assert.equal(ecsJson.cloudMapNamespace.name, 'kartik.local');
    assert.equal(
      ecsJson.cloudMapNamespace.services.agent,
      'http://agent.kartik.local:8003',
    );
    assert.equal(ecsJson.taskDefinitions.length, 6);

    const iamPath = path.join(
      repoRoot,
      'infra/aws/iam/least-privilege-policies.json',
    );
    assert.ok(fs.existsSync(iamPath));
    const iamJson = JSON.parse(fs.readFileSync(iamPath, 'utf8')) as {
      Policies: {
        KartikAgentPrivateObjectStoragePolicy: {
          Statement: Array<{ Sid: string; Effect: string }>;
        };
      };
    };
    const denyStmt =
      iamJson.Policies.KartikAgentPrivateObjectStoragePolicy.Statement.find(
        (s) => s.Sid === 'DenyPublicAclModifications',
      );
    assert.ok(denyStmt);
    assert.equal(denyStmt.Effect, 'Deny');
  });

  it('verifies all 7 workspace package.json manifests use clean SaaS scripts (build, typecheck, lint, test) and lint-workspace.mjs enforces architectural boundaries', async () => {
    const workspacePkgPaths = [
      'backend/shared/package.json',
      'backend/gateway/package.json',
      'backend/services/auth/package.json',
      'backend/services/chat/package.json',
      'backend/services/agent/package.json',
      'backend/services/billing/package.json',
      'frontend/package.json',
    ];

    for (const relPkg of workspacePkgPaths) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, relPkg), 'utf8'),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts: Record<string, string>;
      };
      assert.ok(
        pkg.devDependencies?.typescript,
        `${relPkg} must explicitly declare typescript in devDependencies`,
      );
      assert.ok(
        pkg.devDependencies?.['@types/node'],
        `${relPkg} must explicitly declare @types/node in devDependencies`,
      );
      if (relPkg === 'backend/shared/package.json') {
        assert.ok(
          pkg.dependencies?.pg,
          'backend/shared/package.json must declare runtime dependency pg',
        );
      } else {
        assert.equal(
          pkg.dependencies?.['@kartik/shared'],
          'workspace:*',
          `${relPkg} must declare @kartik/shared workspace dependency`,
        );
      }
      if (relPkg === 'frontend/package.json') {
        assert.equal(
          pkg.scripts.build,
          'tsc && vite build --config vite.config.ts',
          'frontend/package.json build must run tsc and vite build --config vite.config.ts',
        );
        assert.equal(
          pkg.scripts.dev,
          'vite --config vite.config.ts',
          'frontend/package.json dev must run vite --config vite.config.ts',
        );
      } else {
        assert.equal(pkg.scripts.build, 'tsc', `${relPkg} build must be "tsc"`);
      }
      assert.equal(
        pkg.scripts.typecheck,
        'tsc --noEmit',
        `${relPkg} typecheck must be "tsc --noEmit"`,
      );
      assert.ok(
        pkg.scripts.lint?.includes('lint-workspace.mjs'),
        `${relPkg} lint must invoke lint-workspace.mjs`,
      );
      assert.ok(
        !JSON.stringify(pkg.scripts).includes('tsconfig.tsbuildinfo'),
        `${relPkg} must not contain inline tsconfig.tsbuildinfo hacks`,
      );
    }

    const frontendDockerfile = fs.readFileSync(
      path.join(repoRoot, 'frontend/Dockerfile'),
      'utf8',
    );
    assert.ok(frontendDockerfile.includes('frontend/vite.config.ts'));
    assert.ok(frontendDockerfile.includes('frontend/index.html'));
    assert.ok(
      frontendDockerfile.includes('test -f /usr/share/nginx/html/index.html'),
    );

    const nginxConf = fs.readFileSync(
      path.join(repoRoot, 'infra/nginx/default.conf'),
      'utf8',
    );
    assert.ok(nginxConf.includes('location = /nginx-healthz'));
    assert.ok(nginxConf.includes('location /assets/'));
    assert.ok(nginxConf.includes('proxy_buffering off;'));
    assert.ok(nginxConf.includes('try_files $uri $uri/ /index.html;'));

    const { pathToFileURL } = await import('node:url');
    const lintScriptPath = path.join(repoRoot, 'scripts/lint-workspace.mjs');
    const lintMod = (await import(pathToFileURL(lintScriptPath).href)) as {
      lintDirectory: (dir: string) => {
        filesChecked: number;
        violations: Array<{ rule: string }>;
      };
    };

    const backendLint = lintMod.lintDirectory(path.join(repoRoot, 'backend'));
    assert.ok(backendLint.filesChecked >= 100);
    assert.equal(backendLint.violations.length, 0);

    const frontendLint = lintMod.lintDirectory(path.join(repoRoot, 'frontend'));
    assert.ok(frontendLint.filesChecked >= 15);
    assert.equal(frontendLint.violations.length, 0);
  });
});

