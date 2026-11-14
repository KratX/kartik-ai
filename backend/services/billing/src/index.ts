/**
 * @kartik/billing — Package Barrel (Micro-step 4.4.a — Phase 4 Exit Gate Closure).
 */

export * from './config/index.js';
export * from './models/index.js';
export * from './repositories/index.js';
export * from './services/index.js';
export * from './webhooks/index.js';
export * from './middleware/index.js';
export * from './controllers/index.js';
export * from './routes/index.js';
export * from './server.js';

import { isExecutedAsMainModule } from '@kartik/shared';
import { startBillingServer } from './server.js';

if (isExecutedAsMainModule(import.meta.url)) {
  startBillingServer().catch((err: unknown) => {
    process.stderr.write(
      `[billing] Fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}

