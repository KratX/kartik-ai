/**
 * @file backend/gateway/src/index.ts
 * @description @kartik/gateway package entry barrel & CLI entrypoint (Phases 3, 8 & 16).
 */

import { isExecutedAsMainModule } from '@kartik/shared';
import { startGatewayServer } from './server/index.js';

export * from './config/index.js';
export * from './middleware/index.js';
export * from './proxy/index.js';
export * from './routes/index.js';
export * from './readiness/index.js';
export * from './server/index.js';

if (isExecutedAsMainModule(import.meta.url)) {
  startGatewayServer().catch((err: unknown) => {
    console.error('[gateway] Fatal startup error:', err);
    process.exit(1);
  });
}
