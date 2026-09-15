/**
 * Purpose / Goal:
 * Security assertion test for the limited-system-activity workflow template.
 * Verifies that attempting to export CSV data when allow_csv_export is configured as false (or omitted)
 * is strictly rejected by the backend handler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

test('limited-system-activity — unauthorized CSV export guard', async () => {
  const context = createTestContext({
    userId: '1',
    parameters: { explores: [{ name: 'history', allow_csv_export: false }] }
  });

  await assert.rejects(
    async () => await handler(context, 'export_csv', { explore_name: 'history' }),
    /CSV export is not enabled/
  );
});
