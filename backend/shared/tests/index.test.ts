import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_PACKAGE_NAME, SHARED_PACKAGE_VERSION } from '../index.js';

describe('@kartik/shared barrel baseline (1.1.b)', () => {
  it('exports the canonical package name and version', () => {
    assert.equal(SHARED_PACKAGE_NAME, '@kartik/shared');
    assert.equal(SHARED_PACKAGE_VERSION, '0.1.0');
  });
});
