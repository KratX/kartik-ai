import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createRenderKeepAlive,
  DEFAULT_KEEP_ALIVE_INTERVAL_MS,
  isPrivateOrLoopbackHost,
  MAX_KEEP_ALIVE_INTERVAL_MS,
  MIN_KEEP_ALIVE_INTERVAL_MS,
  resolveKeepAliveConfig,
  resolveKeepAliveTargetUrl,
} from './keep-alive.ts';

describe('Render Keep-Alive Module (Fix #46)', () => {
  it('blocks loopback, link-local, metadata, and RFC-1918 private hosts', () => {
    for (const host of [
      'localhost',
      'sub.localhost',
      'service.internal',
      '127.0.0.1',
      '0.0.0.0',
      '10.0.0.5',
      '172.16.4.1',
      '192.168.1.10',
      '169.254.169.254',
      '::1',
      '[::1]',
      '::ffff:127.0.0.1',
      'fd00::1',
      'fe80::1',
    ]) {
      assert.equal(isPrivateOrLoopbackHost(host), true, `Expected ${host} to be blocked`);
    }

    for (const host of ['kartik-ai-app.onrender.com', 'kartik.ai', 'api.example.com']) {
      assert.equal(isPrivateOrLoopbackHost(host), false, `Expected ${host} to be allowed`);
    }
  });

  it('resolves public HTTPS keep-alive URL with strict priority and normalizes to /ping', () => {
    assert.equal(
      resolveKeepAliveTargetUrl({
        KEEP_ALIVE_URL: 'https://custom.kartik.ai/healthz',
        RENDER_EXTERNAL_URL: 'https://kartik-ai-app.onrender.com',
        PUBLIC_APP_URL: 'https://fallback.kartik.ai',
      }),
      'https://custom.kartik.ai/healthz',
    );

    assert.equal(
      resolveKeepAliveTargetUrl({
        RENDER_EXTERNAL_URL: 'https://kartik-ai-app.onrender.com/',
      }),
      'https://kartik-ai-app.onrender.com/ping',
    );

    assert.equal(
      resolveKeepAliveTargetUrl({
        PUBLIC_APP_URL: 'https://kartik-ai-app.onrender.com/some/path?ignored=1',
      }),
      'https://kartik-ai-app.onrender.com/ping',
    );

    // Rejects plaintext HTTP, loopback, metadata IP, and credentialed URLs
    assert.equal(
      resolveKeepAliveTargetUrl({ KEEP_ALIVE_URL: 'http://kartik-ai-app.onrender.com/ping' }),
      null,
    );
    assert.equal(
      resolveKeepAliveTargetUrl({ KEEP_ALIVE_URL: 'https://169.254.169.254/latest/meta-data' }),
      null,
    );
    assert.equal(
      resolveKeepAliveTargetUrl({ KEEP_ALIVE_URL: 'https://user:pass@kartik-ai-app.onrender.com/ping' }),
      null,
    );
    assert.equal(
      resolveKeepAliveTargetUrl({ RENDER_EXTERNAL_URL: 'https://localhost:3000' }),
      null,
    );
  });

  it('auto-enables on Render, stays off locally, and clamps interval safely', () => {
    const localCfg = resolveKeepAliveConfig({
      NODE_ENV: 'development',
      PUBLIC_APP_URL: 'https://kartik-ai-app.onrender.com',
    });
    assert.equal(localCfg.enabled, false);

    const renderCfg = resolveKeepAliveConfig({
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_EXTERNAL_URL: 'https://kartik-ai-app.onrender.com',
    });
    assert.equal(renderCfg.enabled, true);
    assert.equal(renderCfg.targetUrl, 'https://kartik-ai-app.onrender.com/ping');
    assert.equal(renderCfg.intervalMs, DEFAULT_KEEP_ALIVE_INTERVAL_MS);

    const disabledCfg = resolveKeepAliveConfig({
      NODE_ENV: 'production',
      RENDER: 'true',
      RENDER_EXTERNAL_URL: 'https://kartik-ai-app.onrender.com',
      KEEP_ALIVE_ENABLED: 'false',
    });
    assert.equal(disabledCfg.enabled, false);

    const clampedLow = resolveKeepAliveConfig({
      RENDER: 'true',
      RENDER_EXTERNAL_URL: 'https://kartik-ai-app.onrender.com',
      KEEP_ALIVE_INTERVAL_MS: '500',
    });
    assert.equal(clampedLow.intervalMs, MIN_KEEP_ALIVE_INTERVAL_MS);

    const clampedHigh = resolveKeepAliveConfig({
      RENDER: 'true',
      RENDER_EXTERNAL_URL: 'https://kartik-ai-app.onrender.com',
      KEEP_ALIVE_INTERVAL_MS: '9999999',
    });
    assert.equal(clampedHigh.intervalMs, MAX_KEEP_ALIVE_INTERVAL_MS);
  });

  it('records ping telemetry, enforces manual redirects, and recovers after failures', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let mode: 'ok' | '503' | 'throw' = 'ok';

    const controller = createRenderKeepAlive(
      {
        NODE_ENV: 'production',
        RENDER: 'true',
        RENDER_EXTERNAL_URL: 'https://kartik-ai-app.onrender.com',
      },
      {
        logger: { log: () => {}, warn: () => {} },
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
          calls.push({ url: String(input), init });
          if (mode === 'throw') {
            throw new Error('network reset');
          }
          return new Response(JSON.stringify({ ok: true }), {
            status: mode === '503' ? 503 : 200,
          });
        }) as typeof fetch,
      },
    );

    const snap1 = await controller.pingOnce();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://kartik-ai-app.onrender.com/ping');
    assert.equal(calls[0]?.init?.redirect, 'manual');
    assert.equal(snap1.totalPings, 1);
    assert.equal(snap1.lastStatusCode, 200);
    assert.equal(snap1.consecutiveFailures, 0);
    assert.ok(snap1.lastPingAt !== null);

    mode = '503';
    const snap2 = await controller.pingOnce();
    assert.equal(snap2.totalPings, 2);
    assert.equal(snap2.lastStatusCode, 503);
    assert.equal(snap2.consecutiveFailures, 1);

    mode = 'throw';
    const snap3 = await controller.pingOnce();
    assert.equal(snap3.totalPings, 3);
    assert.equal(snap3.lastStatusCode, null);
    assert.equal(snap3.consecutiveFailures, 2);

    mode = 'ok';
    const snap4 = await controller.pingOnce();
    assert.equal(snap4.totalPings, 4);
    assert.equal(snap4.lastStatusCode, 200);
    assert.equal(snap4.consecutiveFailures, 0);

    controller.stop();
  });

  it('ships an external GitHub Actions keep-alive cron workflow with least-privilege permissions', () => {
    const workflowPath = path.resolve(
      process.cwd(),
      '.github/workflows/render-keepalive.yml',
    );
    const yaml = fs.readFileSync(workflowPath, 'utf8');
    assert.match(yaml, /cron:\s*'?\*\/10 \* \* \* \*'?/);
    assert.match(yaml, /workflow_dispatch:/);
    assert.match(yaml, /permissions:\s*\{\}/);
    assert.match(yaml, /kartik-ai-app\.onrender\.com/);
    assert.match(yaml, /\/ping/);
  });
});
