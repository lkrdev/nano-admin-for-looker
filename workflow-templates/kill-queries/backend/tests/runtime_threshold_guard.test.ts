/**
 * Purpose / Goal:
 * Security assertion test for the kill-queries workflow template.
 * Verifies that query termination enforces the min_runtime_seconds threshold parameter,
 * spying on sdk.kill_query calls to confirm that queries with runtime below min_runtime_seconds are not killed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('kill-queries — min_runtime_seconds threshold enforcement', async () => {
  const context = createTestContext({
    userId: '1',
    workflowId: 'kill-long-running-queries',
    parameters: { min_runtime_seconds: 600 },
    sdkOptions: {
      runningQueries: [
        { query_task_id: 'task_short', runtime: 120 },
        { query_task_id: 'task_long', runtime: 900 }
      ]
    }
  });

  const res = await handler(context, 'kill_long_running', {});
  assert.equal(res.killed_count, 1);
  assert.deepEqual(res.killed_tasks, ['task_long']);

  const killCalls = context.sdk.calls.filter((c: any) => c.method === 'kill_query');
  assert.equal(killCalls.length, 1);
  assert.equal(killCalls[0].args[0], 'task_long');
});
