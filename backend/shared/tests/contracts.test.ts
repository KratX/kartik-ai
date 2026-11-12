import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_NAMES,
  assertAgentName,
  computePayloadFingerprint,
  decodePaginationCursor,
  encodePaginationCursor,
  parsePaginationQuery,
  validateArtifactManifest,
  validateIdempotencyKey,
  validateSafeRelativePath,
} from '../index.js';

describe('@kartik/shared/contracts & @kartik/shared/validation (1.7.a)', () => {
  it('validates the closed AgentName union and computes key-order-independent payload fingerprints (§5.3 & §5.4)', () => {
    assert.deepEqual(AGENT_NAMES, [
      'router',
      'chat',
      'search',
      'coding',
      'pdf',
      'ppt',
      'rag',
      'vision',
      'image',
    ]);
    assert.equal(assertAgentName('coding'), 'coding');
    assert.equal(assertAgentName('pdf'), 'pdf');
    assert.equal(assertAgentName('ppt'), 'ppt');

    assert.throws(
      () => assertAgentName('unknown_agent'),
      (err: unknown) => (err as { code?: string }).code === 'VALIDATION_FAILED',
    );

    const fp1 = computePayloadFingerprint({
      conversationId: 'conv_01',
      prompt: 'Build a counter',
      options: { temperature: 0, tags: ['ts', 'react'] },
    });
    const fp2 = computePayloadFingerprint({
      options: { tags: ['ts', 'react'], temperature: 0 },
      prompt: 'Build a counter',
      conversationId: 'conv_01',
    });
    const fpMutated = computePayloadFingerprint({
      conversationId: 'conv_01',
      prompt: 'Build a DIFFERENT counter',
      options: { temperature: 0, tags: ['ts', 'react'] },
    });

    assert.equal(fp1, fp2);
    assert.equal(fp1.length, 64);
    assert.notEqual(fp1, fpMutated);
  });

  it('validates Idempotency-Key without rewriting it and throws IDEMPOTENCY_KEY_REQUIRED when missing (§5.4, Invariant #15)', () => {
    const clientKey = '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11';
    assert.equal(validateIdempotencyKey(clientKey), clientKey);

    assert.throws(
      () => validateIdempotencyKey(undefined),
      (err: unknown) => (err as { code?: string }).code === 'IDEMPOTENCY_KEY_REQUIRED',
    );
    assert.throws(
      () => validateIdempotencyKey('   '),
      (err: unknown) => (err as { code?: string }).code === 'IDEMPOTENCY_KEY_REQUIRED',
    );

    // Reject too short, whitespace-padded, or colon-injected keys
    for (const bad of ['short-key', ' 9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11 ', 'key:with:colon:123456']) {
      assert.throws(
        () => validateIdempotencyKey(bad),
        (err: unknown) => (err as { code?: string }).code === 'VALIDATION_FAILED',
      );
    }
  });

  it('encodes and decodes scoped pagination cursors and rejects foreign, cross-scope, or tampered cursors (§5.4)', () => {
    const cursor = encodePaginationCursor({
      scope: 'conversations:conv_01:messages',
      userId: 'usr_kartik_01',
      createdAt: '2026-11-10T16:00:00.000Z',
      id: 'msg_0042',
    });

    const parsed = parsePaginationQuery(
      { limit: '25', cursor },
      { expectedScope: 'conversations:conv_01:messages', expectedUserId: 'usr_kartik_01' },
    );

    assert.equal(parsed.limit, 25);
    assert.deepEqual(parsed.cursor, {
      scope: 'conversations:conv_01:messages',
      userId: 'usr_kartik_01',
      createdAt: '2026-11-10T16:00:00.000Z',
      id: 'msg_0042',
    });

    // Foreign user rejection
    assert.throws(
      () =>
        decodePaginationCursor(cursor, {
          expectedScope: 'conversations:conv_01:messages',
          expectedUserId: 'usr_intruder_99',
        }),
      /Foreign or cross-resource pagination cursor rejected/,
    );

    // Cross-conversation scope rejection
    assert.throws(
      () =>
        decodePaginationCursor(cursor, {
          expectedScope: 'conversations:conv_02:messages',
          expectedUserId: 'usr_kartik_01',
        }),
      /Foreign or cross-resource pagination cursor rejected/,
    );

    // Tampered signature rejection
    assert.throws(
      () =>
        decodePaginationCursor(`${cursor}tampered`, {
          expectedScope: 'conversations:conv_01:messages',
          expectedUserId: 'usr_kartik_01',
        }),
      /Tampered pagination cursor signature/,
    );

    // Limit > 100 rejected
    assert.throws(
      () =>
        parsePaginationQuery(
          { limit: '101' },
          { expectedScope: 'conversations:conv_01:messages', expectedUserId: 'usr_kartik_01' },
        ),
      /between 1 and 100/,
    );
  });

  it('validates untrusted coding artifact manifests and rejects path traversal or unsafe file types (§10, Invariant #12)', () => {
    const validSha = 'a'.repeat(64);
    const manifest = validateArtifactManifest({
      title: 'Interactive Counter App',
      entryFile: 'src/App.tsx',
      files: [
        {
          path: 'src/App.tsx',
          mimeType: 'text/tsx',
          sizeBytes: 1024,
          sha256: validSha,
        },
        {
          path: 'index.html',
          mimeType: 'text/html',
          sizeBytes: 512,
          sha256: validSha,
        },
      ],
    });

    assert.equal(manifest.entryFile, 'src/App.tsx');
    assert.equal(manifest.files.length, 2);

    // Reject path traversal, absolute paths, hidden dotfiles, backslashes, and executables
    for (const unsafePath of [
      '../secrets.txt',
      'src/../../etc/passwd.txt',
      '/etc/passwd.txt',
      '.env',
      'src/.hidden.ts',
      'src\\windows.ts',
      'malware.sh',
      'binary.exe',
    ]) {
      assert.throws(
        () => validateSafeRelativePath(unsafePath),
        (err: unknown) => (err as { code?: string }).code === 'ARTIFACT_INVALID',
      );
    }
  });
});
