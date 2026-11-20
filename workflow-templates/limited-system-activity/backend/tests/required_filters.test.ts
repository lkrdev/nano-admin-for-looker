import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('limited-system-activity — required_filter_fields rejects empty values and auto-injected user_id prefix collisions', async () => {
  const context = createTestContext({
    userId: '100',
    workflowId: 'limited-history-audit',
    parameters: {
      explores: [
        {
          name: 'history',
          required_filter_fields: ['history.created_time']
        }
      ],
      user_id_limitation: { mode: 'self' }
    }
  });

  // 1. Empty string or whitespace-only filter value is rejected
  await assert.rejects(
    async () =>
      await handler(context, 'run_query', {
        explore_name: 'history',
        fields: ['history.id'],
        filters: { 'history.created_time': '' }
      }),
    /requires a filter on history\.created_time/
  );

  await assert.rejects(
    async () =>
      await handler(context, 'preview_sql', {
        explore_name: 'history',
        fields: ['history.id'],
        filters: { 'history.created_time': '   ' }
      }),
    /requires a filter on history\.created_time/
  );

  // 2. Non-empty filter value succeeds
  const okRes = await handler(context, 'run_query', {
    explore_name: 'history',
    fields: ['history.id'],
    filters: { 'history.created_time': '7 days' }
  });
  assert.equal(okRes.explore_name, 'history');

  // 3. Auto-injected user_id filter cannot satisfy a required_filter_fields prefix match
  const prefixContext = createTestContext({
    userId: '100',
    workflowId: 'limited-history-audit',
    parameters: {
      explores: [
        {
          name: 'history',
          required_filter_fields: ['user.created_time']
        }
      ],
      user_id_limitation: { mode: 'self' }
    }
  });

  await assert.rejects(
    async () =>
      await handler(prefixContext, 'run_query', {
        explore_name: 'history',
        fields: ['history.id'],
        filters: {}
      }),
    /requires a filter on user\.created_time/
  );
});
