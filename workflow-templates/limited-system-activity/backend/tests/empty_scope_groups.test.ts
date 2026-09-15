/**
 * Purpose / Goal:
 * Security assertion test for the limited-system-activity workflow template.
 * Verifies that when scope_groups resolves to 0 user IDs (e.g. user belongs to no active scope group),
 * the backend handler injects a "-*" filter into the system__activity query so that NO records are returned,
 * preventing data leakage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('limited-system-activity — empty scope_groups injects "-*" filter', async () => {
  const context = createTestContext({
    userId: '99',
    workflowId: 'limited-history-audit',
    parameters: {
      explores: [{ name: 'history' }],
      user_id_limitation: { mode: 'scope_groups' }
    },
    sdkOptions: {
      userGroups: { '99': ['unrelated_group'] },
      scopeGroups: { 'unrelated_group': [] },
      groupAttributeValues: { 'attr_100': [] }
    }
  });

  await handler(context, 'run_query', { explore_name: 'history' });

  const inlineCalls = context.sdk.calls.filter((c: any) => c.method === 'run_inline_query');
  assert.equal(inlineCalls.length, 1);
  assert.equal(inlineCalls[0].args[0].body.filters['history.user_id'], '-*');
});
