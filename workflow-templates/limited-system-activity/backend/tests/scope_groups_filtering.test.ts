/**
 * Purpose / Goal:
 * Security assertion test for the limited-system-activity workflow template.
 * Verifies that when user_id_limitation mode is set to "scope_groups", the backend handler
 * resolves the allowed user IDs from Looker scope groups, spies on sdk.run_inline_query,
 * and asserts that the resulting query filter explicitly sets history.user_id to the allowed user list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, parseMockWorkflowConfig } from '../../../../testing/index';
import { handler } from '../index';

test('limited-system-activity — scope_groups query filter enforcement', async () => {
  const yamlConfig = `
workflows:
  - id: "limited-history-audit"
    template: "limited-system-activity"
    parameters:
      explores:
        - name: "history"
          allow_csv_export: true
      user_id_limitation:
        mode: "scope_groups"
        attribute_name: "nano_admin_is_workflow_scope_group"
`;
  const parsedConfig = parseMockWorkflowConfig(yamlConfig);
  const workflowDef = parsedConfig.workflows[0];

  const context = createTestContext({
    userId: '1',
    workflowId: workflowDef.id,
    parameters: workflowDef.parameters,
    sdkOptions: {
      userGroups: { '1': ['scope_group_1'] },
      scopeGroups: { 'scope_group_1': ['1', '2', '3'] },
      groupAttributeValues: {
        'attr_100': [{ group_id: 'scope_group_1', value: 'yes' }]
      }
    }
  });

  const res = await handler(context, 'run_query', {
    explore_name: 'history',
    fields: ['history.id']
  });

  assert.ok(res);

  const inlineCalls = context.sdk.calls.filter((c: any) => c.method === 'run_inline_query');
  assert.equal(inlineCalls.length, 1);

  const queryBody = inlineCalls[0].args[0].body;
  assert.equal(queryBody.model, 'system__activity');
  assert.equal(queryBody.view, 'history');
  assert.equal(queryBody.filters['history.user_id'], '1,2,3');
});
