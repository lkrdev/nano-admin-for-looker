/**
 * Purpose / Goal:
 * Security assertion test for the limited-system-activity workflow template.
 * Verifies that when user_id_limitation mode is set to "self", the backend handler
 * automatically constrains the query filter to the executing user's own Looker user ID.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('limited-system-activity — self mode user ID filter enforcement', async () => {
  const context = createTestContext({
    userId: '77',
    workflowId: 'limited-history-audit',
    parameters: {
      explores: [{ name: 'history' }],
      user_id_limitation: { mode: 'self' }
    }
  });

  await handler(context, 'run_query', { explore_name: 'history' });

  const inlineCalls = context.sdk.calls.filter((c: any) => c.method === 'run_inline_query');
  assert.equal(inlineCalls.length, 1);
  assert.equal(inlineCalls[0].args[0].body.filters['history.user_id'], '77');
});
