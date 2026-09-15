/**
 * Purpose / Goal:
 * Security assertion test for the crud workflow template.
 * Verifies that when user_id_limitation (mode "self" or "scope_groups") is combined with global non-user-owned target object types
 * (e.g. connections, roles, groups, permissions, content_metadata), the backend handler strictly rejects execution with a
 * configuration error and returns no data, preventing any SDK calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('crud — user_id_limitation combined with global non-user-owned object rejection', async (t) => {
  await t.test('rejects self mode on global connections target', async () => {
    const context = createTestContext({
      userId: '42',
      workflowId: 'connections-crud',
      parameters: {
        target_object: 'connections',
        supported_operations: [{ name: 'list' }],
        user_id_limitation: { mode: 'self' }
      }
    });

    await assert.rejects(
      async () => await handler(context, 'list', {}),
      /global resource and cannot be scoped by user_id_limitation/
    );

    // Assert NO connection SDK calls were issued
    const connCalls = context.sdk.calls.filter((c: any) => c.method === 'all_connections');
    assert.equal(connCalls.length, 0);
  });

  await t.test('rejects scope_groups mode on global roles target', async () => {
    const context = createTestContext({
      userId: '42',
      workflowId: 'roles-crud',
      parameters: {
        target_object: 'roles',
        supported_operations: [{ name: 'list' }],
        user_id_limitation: { mode: 'scope_groups' }
      }
    });

    await assert.rejects(
      async () => await handler(context, 'list', {}),
      /global resource and cannot be scoped by user_id_limitation/
    );

    // Assert NO roles SDK calls were issued
    const roleCalls = context.sdk.calls.filter((c: any) => c.method === 'all_roles');
    assert.equal(roleCalls.length, 0);
  });
});
