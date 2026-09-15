/**
 * Purpose / Goal:
 * Security assertion test for the crud workflow template.
 * Verifies that the list operation on target objects (e.g. users) spies on sdk.all_users and filters
 * the returned objects array so that only objects belonging to allowed scope group user IDs are returned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, parseMockWorkflowConfig } from '../../../../testing/index';
import { handler } from '../index';

test('crud — list operation scope filtering', async () => {
  const yamlConfig = `
workflows:
  - id: "hr-disable-users"
    template: "crud"
    parameters:
      target_object: "users"
      user_id_limitation:
        mode: "scope_groups"
        attribute_name: "nano_admin_is_workflow_scope_group"
      supported_operations:
        - name: "list"
          fields: ["id", "name"]
`;
  const parsedConfig = parseMockWorkflowConfig(yamlConfig);
  const workflowDef = parsedConfig.workflows[0];

  const context = createTestContext({
    userId: '1',
    workflowId: workflowDef.id,
    parameters: workflowDef.parameters,
    sdkOptions: {
      users: {
        '1': { id: '1', name: 'Alice' },
        '2': { id: '2', name: 'Bob' },
        '99': { id: '99', name: 'Eve (Out of Scope)' }
      },
      userGroups: { '1': ['scope_group_1'] },
      scopeGroups: { 'scope_group_1': ['1', '2'] },
      groupAttributeValues: {
        'attr_100': [{ group_id: 'scope_group_1', value: 'yes' }]
      }
    }
  });

  const res = await handler(context, 'list', {});
  assert.equal(res.length, 2);
  assert.deepEqual(res.map((u: any) => u.id), ['1', '2']);

  const listCalls = context.sdk.calls.filter((c: any) => c.method === 'all_users');
  assert.equal(listCalls.length, 1);
});
