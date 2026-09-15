/**
 * Purpose / Goal:
 * Security assertion test for the crud workflow template.
 * Verifies that the read operation on target objects spies on sdk.user and throws a 403 Forbidden
 * exception if the target object's owner ID is outside the allowed scope user IDs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('crud — read operation out-of-scope 403 guard', async () => {
  const context = createTestContext({
    userId: '1',
    parameters: {
      target_object: 'users',
      supported_operations: [{ name: 'read' }],
      user_id_limitation: { mode: 'scope_groups' }
    },
    sdkOptions: {
      users: {
        '999': { id: '999', name: 'Out of Scope User' }
      },
      userGroups: { '1': ['scope_group_1'] },
      scopeGroups: { 'scope_group_1': ['1', '2'] },
      groupAttributeValues: {
        'attr_100': [{ group_id: 'scope_group_1', value: 'yes' }]
      }
    }
  });

  await assert.rejects(
    async () => await handler(context, 'read', { id: '999' }),
    /403 Forbidden: Target user does not belong to an allowed user scope/
  );

  const readCalls = context.sdk.calls.filter((c: any) => c.method === 'user');
  assert.equal(readCalls.length, 1);
  assert.equal(readCalls[0].args[0], '999');
});
