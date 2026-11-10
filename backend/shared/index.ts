/**
 * @kartik/shared — Root barrel module (Blueprint §4.1 & §7.2 Phase 1).
 *
 * Each Phase 1 capability (config, errors, logger, contracts, redis,
 * database, auth, middleware, storage, validation) is re-exported here
 * as its micro-step is completed.
 */
export const SHARED_PACKAGE_NAME = '@kartik/shared' as const;
export const SHARED_PACKAGE_VERSION = '0.1.0' as const;

export * from './config/index.js';
export * from './errors/index.js';
export * from './logger/index.js';
export * from './redis/index.js';
export * from './auth/index.js';
export * from './contracts/index.js';
export * from './validation/index.js';
export * from './database/index.js';
export * from './storage/index.js';




