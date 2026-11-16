/**
 * Purpose / Goal:
 * Security assertion tests for owner ID extraction in the crud workflow template.
 * Verifies that unowned/global non-user resources (e.g. folders without `user_id`)
 * do not fall back to `item.id`, preventing ID-collision authorization bypasses
 * across list, read, update, and delete operations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext } from '../../../../testing/index';
import { handler } from '../index';

function createFolderContext() {
  const calls: Array<{ method: string; args: any[] }> = [];
  const folders: Record<string, any> = {
    '42': { id: '42', name: 'Global Shared Folder', user_id: null },
    '43': { id: '43', name: 'Nested User Folder', user: { id: '42' } },
    '44': { id: '44', name: 'Owned Folder', user_id: '42' }
  };

  const sdk = {
    calls,
    ok: async (p: any) => await p,
    all_folders: async () => {
      calls.push({ method: 'all_folders', args: [] });
      return Object.values(folders);
    },
    folder: async (id: string) => {
      calls.push({ method: 'folder', args: [id] });
      return folders[id];
    },
    update_folder: async (id: string, body: any) => {
      calls.push({ method: 'update_folder', args: [id, body] });
      return { id, ...body };
    },
    delete_folder: async (id: string) => {
      calls.push({ method: 'delete_folder', args: [id] });
      return {};
    }
  };

  return createTestContext({
    userId: '42',
    sdk,
    parameters: {
      target_object: 'folders',
      supported_operations: [
        { name: 'list' },
        { name: 'read' },
        { name: 'update', fields: ['name'] },
        { name: 'delete' }
      ],
      user_id_limitation: { mode: 'self' }
    }
  });
}

test('crud — list excludes unowned global resources whose id collides with userId', async () => {
  const context = createFolderContext();
  const items = await handler(context, 'list', {});

  assert.deepEqual(
    items.map((i: any) => i.id),
    ['43', '44']
  );
});

test('crud — read, update, and delete reject unowned global resource whose id collides with userId', async () => {
  const context = createFolderContext();

  await assert.rejects(
    async () => await handler(context, 'read', { id: '42' }),
    /403 Forbidden: Target folder does not belong to an allowed user scope/
  );

  await assert.rejects(
    async () => await handler(context, 'update', { id: '42', body: { name: 'Pwned' } }),
    /403 Forbidden: Target folder does not belong to an allowed user scope/
  );

  await assert.rejects(
    async () => await handler(context, 'delete', { id: '42' }),
    /403 Forbidden: Target folder does not belong to an allowed user scope/
  );

  assert.equal(context.sdk.calls.filter((c: any) => c.method === 'update_folder').length, 0);
  assert.equal(context.sdk.calls.filter((c: any) => c.method === 'delete_folder').length, 0);
});
