import { test } from 'node:test';
import assert from 'node:assert';
import { sanitizeHostForSecret } from './index';

test('sanitizeHostForSecret — standard host names', () => {
  const result = sanitizeHostForSecret('looker.example.com');
  assert.strictEqual(result, 'looker_example_com');
  assert.strictEqual(`NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_${result}`.length < 255, true);
});

test('sanitizeHostForSecret — extremely long host names (>180 chars)', () => {
  const longHost = 'a'.repeat(250) + '.cloud.looker.com';
  const result = sanitizeHostForSecret(longHost);
  
  // Truncated to 180 + '_' + 16 hex hash = 197 chars
  assert.strictEqual(result.length, 197);

  const fullSecretName = `NANO_ADMIN_LOOKERSDK_CLIENT_SECRET_${result}`;
  assert.strictEqual(fullSecretName.length <= 255, true);

  // Assert distinct hashes for two long hosts that start with same prefix
  const longHost2 = 'a'.repeat(250) + '.other.looker.com';
  const result2 = sanitizeHostForSecret(longHost2);
  assert.notStrictEqual(result, result2);
});
