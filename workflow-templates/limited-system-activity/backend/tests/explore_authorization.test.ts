/**
 * Purpose / Goal:
 * Security assertion test for the limited-system-activity workflow template.
 * Verifies that when user_id_limitation is configured as "self", attempting to query an unsupported/unpermitted explore
 * throws an explicit error and returns no data, ensuring sdk.run_inline_query is never executed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('limited-system-activity — self mode combined with unsupported explore rejection', async () => {
  const context = createTestContext({
    userId: '42',
    workflowId: 'limited-history-audit',
    parameters: {
      explores: [{ name: 'history' }],
      user_id_limitation: { mode: 'self' }
    }
  });

  await assert.rejects(
    async () => await handler(context, 'run_query', { explore_name: 'unsupported_system_explore' }),
    /is not permitted for this workflow/
  );

  // Assert NO inline query was issued to Looker
  const inlineCalls = context.sdk.calls.filter((c: any) => c.method === 'run_inline_query');
  assert.equal(inlineCalls.length, 0);
});
