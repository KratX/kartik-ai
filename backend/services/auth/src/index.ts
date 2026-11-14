/**
 * @kartik/auth — Auth Service Package Entry Barrel & CLI Entrypoint (Phases 2 & 16).
 */
import { isExecutedAsMainModule } from '@kartik/shared';
import { startAuthServer } from './server.js';

export * from './config/index.js';
export * from './controllers/index.js';
export * from './middleware/index.js';
export * from './models/index.js';
export * from './repositories/index.js';
export * from './routes/index.js';
export * from './services/index.js';
export * from './server.js';

if (isExecutedAsMainModule(import.meta.url)) {
  startAuthServer().catch((err: unknown) => {
    console.error('[auth] Fatal startup error:', err);
    process.exit(1);
  });
}
