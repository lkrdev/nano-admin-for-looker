/**
 * Purpose / Goal:
 * Security assertion test for the crud workflow template.
 * Verifies that the update operation checks existing resource ownership first and throws a 403 Forbidden
 * exception if the resource belongs to an out-of-scope user ID, preventing sdk.update_user from being called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('crud — update operation out-of-scope 403 guard', async () => {
  const context = createTestContext({
    userId: '1',
    parameters: {
      target_object: 'users',
      supported_operations: [{ name: 'update' }, { name: 'read' }],
      user_id_limitation: { mode: 'scope_groups' }
    },
    sdkOptions: {
      users: {
        '999': { id: '999', name: 'Eve' }
      },
      userGroups: { '1': ['scope_group_1'] },
      scopeGroups: { 'scope_group_1': ['1', '2'] },
      groupAttributeValues: {
        'attr_100': [{ group_id: 'scope_group_1', value: 'yes' }]
      }
    }
  });

  await assert.rejects(
    async () => await handler(context, 'update', { id: '999', body: { is_disabled: true } }),
    /403 Forbidden: Target user does not belong to an allowed user scope/
  );

  const updateCalls = context.sdk.calls.filter((c: any) => c.method === 'update_user');
  assert.equal(updateCalls.length, 0);
});
