/**
 * Purpose / Goal:
 * Security assertion test for the crud workflow template.
 * Verifies that when user_id_limitation mode is set to "self", the list operation filters items strictly
 * to the executing user's own ID, and reading or modifying another user's resource throws a 403 Forbidden error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, parseMockWorkflowConfig } from '../../../../testing/index';
import { handler } from '../index';

test('crud — self mode filtering and 403 authorization guards', async (t) => {
  await t.test('filters list operation to executing user own record in self mode', async () => {
    const yamlConfig = `
workflows:
  - id: "self-user-profile"
    template: "crud"
    parameters:
      target_object: "users"
      user_id_limitation:
        mode: "self"
      supported_operations:
        - name: "list"
          fields: ["id", "name"]
`;
    const parsedConfig = parseMockWorkflowConfig(yamlConfig);
    const workflowDef = parsedConfig.workflows[0];

    const context = createTestContext({
      userId: '42',
      workflowId: workflowDef.id,
      parameters: workflowDef.parameters,
      sdkOptions: {
        users: {
          '42': { id: '42', name: 'Current User' },
          '99': { id: '99', name: 'Other User' }
        }
      }
    });

    const res = await handler(context, 'list', {});
    assert.equal(res.length, 1);
    assert.equal(res[0].id, '42');
  });

  await t.test('rejects read operation for another user ID in self mode', async () => {
    const context = createTestContext({
      userId: '42',
      parameters: {
        target_object: 'users',
        supported_operations: [{ name: 'read' }],
        user_id_limitation: { mode: 'self' }
      },
      sdkOptions: {
        users: {
          '999': { id: '999', name: 'Other User' }
        }
      }
    });

    await assert.rejects(
      async () => await handler(context, 'read', { id: '999' }),
      /403 Forbidden: Target user does not belong to an allowed user scope/
    );
  });
});
