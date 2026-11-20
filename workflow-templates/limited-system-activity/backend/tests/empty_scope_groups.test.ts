/**
 * Purpose / Goal:
 * Security assertion test for the limited-system-activity workflow template.
 * Verifies that when scope_groups resolves to 0 user IDs (e.g. user belongs to no active scope group),
 * the backend handler short-circuits and returns empty results without invoking sdk.run_inline_query,
 * preventing data leakage via Looker filter expressions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('limited-system-activity — empty scope_groups short-circuits without calling run_inline_query', async () => {
  const context = createTestContext({
    userId: '99',
    workflowId: 'limited-history-audit',
    parameters: {
      explores: [{ name: 'history', allow_csv_export: true }],
      user_id_limitation: { mode: 'scope_groups' }
    },
    sdkOptions: {
      userGroups: { '99': ['unrelated_group'] },
      scopeGroups: { 'unrelated_group': [] },
      groupAttributeValues: { 'attr_100': [] }
    }
  });

  const runRes = await handler(context, 'run_query', { explore_name: 'history' });
  assert.deepEqual(runRes.rows, []);
  assert.equal(runRes.row_count, 0);

  const sqlRes = await handler(context, 'preview_sql', { explore_name: 'history' });
  assert.match(sqlRes.sql, /No accessible users in scope/i);

  const csvRes = await handler(context, 'export_csv', { explore_name: 'history' });
  assert.equal(csvRes.csv_data, '');

  const inlineCalls = context.sdk.calls.filter((c: any) => c.method === 'run_inline_query');
  assert.equal(inlineCalls.length, 0);
});
