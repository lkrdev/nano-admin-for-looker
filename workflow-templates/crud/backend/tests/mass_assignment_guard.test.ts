/**
 * Purpose / Goal:
 * Security assertion tests for mass-assignment protection in the crud workflow template.
 * Verifies that `create` and `update` strictly enforce `opConfig.fields` as a write allowlist,
 * fail closed when `fields` is omitted or empty, permit `fields: ['*']`, and apply `opConfig.values` last.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('crud — create rejects disallowed fields with 403 and makes no SDK call', async () => {
  const context = createTestContext({
    userId: '1',
    parameters: {
      target_object: 'users',
      supported_operations: [
        {
          name: 'create',
          fields: ['first_name', 'last_name'],
          values: { is_disabled: true }
        }
      ],
      user_id_limitation: { mode: 'none' }
    }
  });

  await assert.rejects(
    async () =>
      await handler(context, 'create', {
        body: { first_name: 'John', last_name: 'Doe', is_admin: true }
      }),
    /403 Forbidden: Field\(s\) "is_admin" are not permitted/
  );

  assert.equal(context.sdk.calls.length, 0);
});

test('crud — create allows configured fields and enforces forced values precedence', async () => {
  const context = createTestContext({
    userId: '1',
    parameters: {
      target_object: 'users',
      supported_operations: [
        {
          name: 'create',
          fields: ['first_name', 'last_name', 'is_disabled'],
          values: { is_disabled: true }
        }
      ],
      user_id_limitation: { mode: 'none' }
    }
  });

  await handler(context, 'create', {
    body: { id: '999', user_id: '999', first_name: 'Jane', last_name: 'Doe', is_disabled: false }
  });

  const createCalls = context.sdk.calls.filter((c: any) => c.method === 'create_user');
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0].args[0], {
    first_name: 'Jane',
    last_name: 'Doe',
    is_disabled: true
  });
});

test('crud — create fails closed when fields is omitted', async () => {
  const context = createTestContext({
    userId: '1',
    parameters: {
      target_object: 'users',
      supported_operations: [{ name: 'create', values: { is_disabled: true } }],
      user_id_limitation: { mode: 'none' }
    }
  });

  await assert.rejects(
    async () => await handler(context, 'create', { body: { first_name: 'John' } }),
    /403 Forbidden: Field\(s\) "first_name" are not permitted/
  );

  // Empty body with forced values still succeeds
  await handler(context, 'create', { body: {} });
  const createCalls = context.sdk.calls.filter((c: any) => c.method === 'create_user');
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0].args[0], { is_disabled: true });
});

test('crud — create allows arbitrary fields when fields includes wildcard', async () => {
  const context = createTestContext({
    userId: '1',
    parameters: {
      target_object: 'users',
      supported_operations: [{ name: 'create', fields: ['*'] }],
      user_id_limitation: { mode: 'none' }
    }
  });

  await handler(context, 'create', {
    body: { id: 'ignored', user_id: 'ignored', first_name: 'Alex', email: 'alex@example.com' }
  });

  const createCalls = context.sdk.calls.filter((c: any) => c.method === 'create_user');
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0].args[0], {
    first_name: 'Alex',
    email: 'alex@example.com'
  });
});

test('crud — update rejects disallowed fields with 403 and makes no update SDK call', async () => {
  const context = createTestContext({
    userId: '1',
    parameters: {
      target_object: 'users',
      supported_operations: [{ name: 'update', fields: ['is_disabled'] }],
      user_id_limitation: { mode: 'none' }
    }
  });

  await assert.rejects(
    async () =>
      await handler(context, 'update', {
        id: '42',
        body: { is_disabled: true, role_ids: ['1'] }
      }),
    /403 Forbidden: Field\(s\) "role_ids" are not permitted/
  );

  const updateCalls = context.sdk.calls.filter((c: any) => c.method === 'update_user');
  assert.equal(updateCalls.length, 0);
});
