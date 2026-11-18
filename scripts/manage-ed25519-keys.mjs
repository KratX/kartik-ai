#!/usr/bin/env node
/**
 * @file scripts/manage-ed25519-keys.mjs
 * @description Production Ed25519 User-Context Key Pair Generator, Secret Provisioner,
 * and Pre-Deployment Cryptographic Validator (Blueprint §6.4, §11 & Phase 16).
 *
 * Capabilities:
 * 1. `generateProductionEd25519KeyPair()`: Generates a valid RFC 8410 Ed25519 PKCS#8 private key
 *    and SPKI public key pair using Node `crypto.generateKeyPairSync('ed25519')`.
 * 2. `provisionComposeEd25519Secrets(options)`: Stores the private key in the Docker Compose
 *    secrets directory (`infra/aws/ec2-compose/secrets/user_context_signing_key.pem`, mode `0600`)
 *    and distributes the corresponding public key (`user_context_public_key.pem`, mode `0644`).
 * 3. `validateProductionEd25519KeyPair(env)`: Validates before deployment that neither key is a
 *    placeholder, that the public key matches the private key, and that a signed user-context
 *    assertion verifies across all downstream service audiences (`chat`, `agent`, `billing`).
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_PLACEHOLDER_MARKERS = Object.freeze([
  'MC4CAQAwBQYDK2VwBCIEIFlocalDevEd25519SeedForKartikAiGateway01',
  'MCowBQYDK2VwAyEAlocalDevEd25519PublicKeyForKartikAiServices0',
  'REPLACE_ME',
  'MOCK_KEY',
  'PLACEHOLDER',
  'changeme',
]);

/**
 * Checks whether a key string is empty or contains known placeholder key material.
 *
 * @param {string | undefined} raw
 * @returns {boolean}
 */
export function isPlaceholderKeyMaterial(raw) {
  if (typeof raw !== 'string') {
    return true;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return true;
  }
  let candidate = trimmed;
  try {
    if (!trimmed.includes('-----BEGIN ')) {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN ')) {
        candidate = `${trimmed}\n${decoded}`;
      }
    }
  } catch {
    // Ignore base64 decode errors
  }
  return FORBIDDEN_PLACEHOLDER_MARKERS.some((marker) =>
    candidate.toLowerCase().includes(marker.toLowerCase()),
  );
}

/**
 * Normalizes a PEM or base64-encoded PEM string.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizePemString(raw) {
  const trimmed = raw.trim().replace(/\\n/g, '\n');
  if (trimmed.startsWith('-----BEGIN ')) {
    return `${trimmed}\n`;
  }
  const decoded = Buffer.from(trimmed, 'base64')
    .toString('utf8')
    .trim()
    .replace(/\\n/g, '\n');
  return `${decoded}\n`;
}

/**
 * Resolves a key value from either a direct environment variable (`valueKey`)
 * or a secret file path (`fileKey`, e.g. `/run/secrets/user_context_signing_key`).
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} valueKey
 * @param {string} [fileKey]
 * @returns {string | undefined}
 */
export function resolveKeyFromEnvOrFile(env, valueKey, fileKey = `${valueKey}_FILE`) {
  const direct = env[valueKey]?.trim();
  if (direct && direct.length > 0) {
    return direct;
  }
  const filePath = env[fileKey]?.trim();
  if (filePath && filePath.length > 0 && fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (content.length > 0) {
      return content;
    }
  }
  return undefined;
}

/**
 * Generates a fresh cryptographically valid Ed25519 PKCS#8 private key and SPKI public key pair.
 *
 * @returns {{ privateKeyPem: string; publicKeyPem: string; privateKeySingleLine: string; publicKeySingleLine: string }}
 */
export function generateProductionEd25519KeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return Object.freeze({
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    privateKeySingleLine: privateKey.trim().replace(/\n/g, '\\n'),
    publicKeySingleLine: publicKey.trim().replace(/\n/g, '\\n'),
  });
}

/**
 * Validates that an Ed25519 private key and public key are valid, non-placeholder,
 * mathematically matched, and pass a sign/verify round-trip across downstream audiences.
 *
 * @param {{ privateKey?: string; publicKey?: string }} input
 * @returns {{ valid: boolean; errors: readonly string[]; derivedPublicKeyPem?: string }}
 */
export function validateProductionEd25519KeyPair(input) {
  /** @type {string[]} */
  const errors = [];
  const { privateKey, publicKey } = input;

  if (!privateKey || privateKey.trim().length === 0) {
    errors.push('Missing USER_CONTEXT_SIGNING_KEY (or USER_CONTEXT_SIGNING_KEY_FILE)');
  } else if (isPlaceholderKeyMaterial(privateKey)) {
    errors.push(
      'USER_CONTEXT_SIGNING_KEY contains placeholder key material (must be a real Ed25519 PKCS#8 private key)',
    );
  }

  if (!publicKey || publicKey.trim().length === 0) {
    errors.push('Missing USER_CONTEXT_PUBLIC_KEY (or USER_CONTEXT_PUBLIC_KEY_FILE)');
  } else if (isPlaceholderKeyMaterial(publicKey)) {
    errors.push(
      'USER_CONTEXT_PUBLIC_KEY contains placeholder key material (must be a real Ed25519 SPKI public key)',
    );
  }

  if (errors.length > 0) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }

  let privObj;
  try {
    privObj = createPrivateKey(normalizePemString(/** @type {string} */ (privateKey)));
    if (privObj.type !== 'private' || privObj.asymmetricKeyType !== 'ed25519') {
      errors.push('USER_CONTEXT_SIGNING_KEY is not an Ed25519 private key');
    }
  } catch {
    errors.push('USER_CONTEXT_SIGNING_KEY is not a valid PKCS#8 PEM/base64 private key');
  }

  let pubObj;
  try {
    pubObj = createPublicKey(normalizePemString(/** @type {string} */ (publicKey)));
    if (pubObj.type !== 'public' || pubObj.asymmetricKeyType !== 'ed25519') {
      errors.push('USER_CONTEXT_PUBLIC_KEY is not an Ed25519 public key');
    }
  } catch {
    errors.push('USER_CONTEXT_PUBLIC_KEY is not a valid SPKI PEM/base64 public key');
  }

  if (errors.length > 0 || !privObj || !pubObj) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }

  const derivedPublicKeyPem = createPublicKey(privObj)
    .export({ format: 'pem', type: 'spki' })
    .toString('utf8')
    .trim();
  const configuredPublicKeyPem = pubObj
    .export({ format: 'pem', type: 'spki' })
    .toString('utf8')
    .trim();

  if (derivedPublicKeyPem !== configuredPublicKeyPem) {
    errors.push(
      'USER_CONTEXT_PUBLIC_KEY does not match the public key derived from USER_CONTEXT_SIGNING_KEY',
    );
    return Object.freeze({
      valid: false,
      errors: Object.freeze(errors),
      derivedPublicKeyPem: `${derivedPublicKeyPem}\n`,
    });
  }

  // Verify signing & verification across all downstream service audiences
  for (const aud of ['chat', 'agent', 'billing']) {
    const headerB64 = Buffer.from(
      JSON.stringify({ alg: 'EdDSA', typ: 'kartik-user-context+jwt' }),
      'utf8',
    ).toString('base64url');
    const claimsB64 = Buffer.from(
      JSON.stringify({
        iss: 'gateway',
        aud,
        sub: 'usr_preflight_verify',
        traceId: 'trc_preflight_verify',
        iat: 1_750_000_000,
        exp: 1_750_000_060,
        jti: `jti_${aud}`,
      }),
      'utf8',
    ).toString('base64url');
    const signingInput = Buffer.from(`${headerB64}.${claimsB64}`, 'utf8');
    const sig = cryptoSign(null, signingInput, privObj);
    const verified = cryptoVerify(null, signingInput, pubObj, sig);
    if (!verified) {
      errors.push(`Ed25519 signature verification failed for downstream audience "${aud}"`);
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    derivedPublicKeyPem: `${derivedPublicKeyPem}\n`,
  });
}

/**
 * Provisions a valid Ed25519 key pair into the Docker Compose secrets directory.
 *
 * @param {{ secretsDir?: string; overwrite?: boolean }} [options]
 * @returns {{ privateKeyPath: string; publicKeyPath: string; publicKeyPem: string }}
 */
export function provisionComposeEd25519Secrets(options = {}) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const secretsDir =
    options.secretsDir ??
    path.join(repoRoot, 'infra', 'aws', 'ec2-compose', 'secrets');
  fs.mkdirSync(secretsDir, { recursive: true });

  const privateKeyPath = path.join(secretsDir, 'user_context_signing_key.pem');
  const publicKeyPath = path.join(secretsDir, 'user_context_public_key.pem');

  if (
    !options.overwrite &&
    fs.existsSync(privateKeyPath) &&
    fs.existsSync(publicKeyPath)
  ) {
    const existingPriv = fs.readFileSync(privateKeyPath, 'utf8');
    const existingPub = fs.readFileSync(publicKeyPath, 'utf8');
    const check = validateProductionEd25519KeyPair({
      privateKey: existingPriv,
      publicKey: existingPub,
    });
    if (check.valid) {
      return Object.freeze({
        privateKeyPath,
        publicKeyPath,
        publicKeyPem: existingPub,
      });
    }
  }

  const pair = generateProductionEd25519KeyPair();
  fs.writeFileSync(privateKeyPath, pair.privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, pair.publicKeyPem, { mode: 0o644 });

  return Object.freeze({
    privateKeyPath,
    publicKeyPath,
    publicKeyPem: pair.publicKeyPem,
  });
}

/**
 * Deployment preflight validator for production Docker Compose (`infra/aws/ec2-compose/docker-compose.prod.yml`).
 * Ensures:
 * 1. `docker-compose.prod.yml` does not set hardcoded `USER_CONTEXT_PUBLIC_KEY` or `USER_CONTEXT_SIGNING_KEY`
 *    environment variables that could override `/run/secrets/user_context_public_key` or `/run/secrets/user_context_signing_key`.
 * 2. `gateway` and all downstream services (`auth`, `chat`, `agent`, `billing`) reference the shared secret files.
 * 3. The generated Ed25519 private/public secret files exist (or are provisioned) and pass a cryptographic
 *    sign/verify round-trip across `chat`, `agent`, and `billing`.
 *
 * @param {{ repoRoot?: string; autoProvisionIfMissing?: boolean }} [options]
 * @returns {{ valid: boolean; errors: readonly string[]; derivedPublicKeyPem?: string }}
 */
export function verifyComposeEd25519Preflight(options = {}) {
  const repoRoot =
    options.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  /** @type {string[]} */
  const errors = [];

  const composePath = path.join(
    repoRoot,
    'infra',
    'aws',
    'ec2-compose',
    'docker-compose.prod.yml',
  );
  if (!fs.existsSync(composePath)) {
    errors.push(`Missing production Compose file at ${composePath}`);
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }

  const composeContent = fs.readFileSync(composePath, 'utf8');
  if (/^\s*USER_CONTEXT_PUBLIC_KEY\s*:/m.test(composeContent)) {
    errors.push(
      'docker-compose.prod.yml must not set USER_CONTEXT_PUBLIC_KEY directly; downstream services must read USER_CONTEXT_PUBLIC_KEY_FILE (/run/secrets/user_context_public_key)',
    );
  }
  if (/^\s*USER_CONTEXT_SIGNING_KEY\s*:/m.test(composeContent)) {
    errors.push(
      'docker-compose.prod.yml must not set USER_CONTEXT_SIGNING_KEY directly; gateway must read USER_CONTEXT_SIGNING_KEY_FILE (/run/secrets/user_context_signing_key)',
    );
  }
  if (
    !composeContent.includes(
      'USER_CONTEXT_SIGNING_KEY_FILE: /run/secrets/user_context_signing_key',
    )
  ) {
    errors.push(
      'docker-compose.prod.yml gateway service must configure USER_CONTEXT_SIGNING_KEY_FILE: /run/secrets/user_context_signing_key',
    );
  }

  const publicKeyFileMatches =
    composeContent.match(
      /USER_CONTEXT_PUBLIC_KEY_FILE:\s*\/run\/secrets\/user_context_public_key/g,
    ) ?? [];
  if (publicKeyFileMatches.length < 5) {
    errors.push(
      `docker-compose.prod.yml must configure USER_CONTEXT_PUBLIC_KEY_FILE: /run/secrets/user_context_public_key across gateway, auth, chat, agent, and billing (found ${publicKeyFileMatches.length})`,
    );
  }

  const secretsDir = path.join(repoRoot, 'infra', 'aws', 'ec2-compose', 'secrets');
  const privateKeyPath = path.join(secretsDir, 'user_context_signing_key.pem');
  const publicKeyPath = path.join(secretsDir, 'user_context_public_key.pem');

  if (
    options.autoProvisionIfMissing &&
    (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath))
  ) {
    provisionComposeEd25519Secrets({ secretsDir });
  }

  if (!fs.existsSync(privateKeyPath)) {
    errors.push(`Missing Compose private key secret file: ${privateKeyPath}`);
  }
  if (!fs.existsSync(publicKeyPath)) {
    errors.push(`Missing Compose public key secret file: ${publicKeyPath}`);
  }

  if (errors.length > 0) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }

  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
  const pairCheck = validateProductionEd25519KeyPair({ privateKey, publicKey });
  if (!pairCheck.valid) {
    errors.push(...pairCheck.errors);
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    derivedPublicKeyPem: pairCheck.derivedPublicKeyPem,
  });
}

const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url).toLowerCase() ===
    process.argv[1].replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase() ||
    process.argv[1].endsWith('manage-ed25519-keys.mjs'));

if (isMain) {
  const args = new Set(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const defaultSecretsDir = path.join(repoRoot, 'infra', 'aws', 'ec2-compose', 'secrets');

  if (args.has('--generate') || args.has('--provision')) {
    const result = provisionComposeEd25519Secrets({
      secretsDir: defaultSecretsDir,
      overwrite: args.has('--force'),
    });
    console.log(
      JSON.stringify({
        status: 'provisioned',
        privateKeySecretPath: path.relative(repoRoot, result.privateKeyPath),
        publicKeySecretPath: path.relative(repoRoot, result.publicKeyPath),
      }),
    );
    process.exit(0);
  }

  const composePreflight = verifyComposeEd25519Preflight({
    repoRoot,
    autoProvisionIfMissing: true,
  });
  if (!composePreflight.valid) {
    for (const err of composePreflight.errors) {
      console.error(`[ed25519-keys] PREFLIGHT ERROR: ${err}`);
    }
    process.exit(1);
  }

  const privateKey =
    resolveKeyFromEnvOrFile(
      process.env,
      'USER_CONTEXT_SIGNING_KEY',
      'USER_CONTEXT_SIGNING_KEY_FILE',
    ) ??
    (fs.existsSync(path.join(defaultSecretsDir, 'user_context_signing_key.pem'))
      ? fs.readFileSync(
          path.join(defaultSecretsDir, 'user_context_signing_key.pem'),
          'utf8',
        )
      : undefined);

  const publicKey =
    resolveKeyFromEnvOrFile(
      process.env,
      'USER_CONTEXT_PUBLIC_KEY',
      'USER_CONTEXT_PUBLIC_KEY_FILE',
    ) ??
    resolveKeyFromEnvOrFile(
      process.env,
      'USER_CONTEXT_VERIFY_KEY',
      'USER_CONTEXT_VERIFY_KEY_FILE',
    ) ??
    (fs.existsSync(path.join(defaultSecretsDir, 'user_context_public_key.pem'))
      ? fs.readFileSync(
          path.join(defaultSecretsDir, 'user_context_public_key.pem'),
          'utf8',
        )
      : undefined);

  const check = validateProductionEd25519KeyPair({ privateKey, publicKey });
  if (!check.valid) {
    for (const err of check.errors) {
      console.error(`[ed25519-keys] ERROR: ${err}`);
    }
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      status: 'verified',
      algorithm: 'Ed25519',
      composePreflight: 'ok',
      audiencesVerified: ['chat', 'agent', 'billing'],
    }),
  );
}
