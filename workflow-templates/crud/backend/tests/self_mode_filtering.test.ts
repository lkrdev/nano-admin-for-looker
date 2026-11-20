/**
 * Purpose / Goal:
 * Security assertion test for the crud workflow template.
 * Verifies that when user_id_limitation mode is set to "self", the list operation filters items strictly
 * to the executing user's own ID, and reading or modifying another user's resource throws a 403 Forbidden error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, parseMockWorkflowConfig } from '../../../../testing/index';
import { handler } from '../index';

test('crud — self mode filtering and 403 authorization guards', async (t) => {
  await t.test('filters list operation to executing user own record in self mode', async () => {
    const yamlConfig = `
workflows:
  - id: "self-user-profile"
    template: "crud"
    parameters:
      target_object: "users"
      user_id_limitation:
        mode: "self"
      supported_operations:
        - name: "list"
          fields: ["id", "name"]
`;
    const parsedConfig = parseMockWorkflowConfig(yamlConfig);
    const workflowDef = parsedConfig.workflows[0];

    const context = createTestContext({
      userId: '42',
      workflowId: workflowDef.id,
      parameters: workflowDef.parameters,
      sdkOptions: {
        users: {
          '42': { id: '42', name: 'Current User' },
          '99': { id: '99', name: 'Other User' }
        }
      }
    });

    const res = await handler(context, 'list', {});
    assert.equal(res.length, 1);
    assert.equal(res[0].id, '42');
  });

  await t.test('rejects read operation for another user ID in self mode', async () => {
    const context = createTestContext({
      userId: '42',
      parameters: {
        target_object: 'users',
        supported_operations: [{ name: 'read' }],
        user_id_limitation: { mode: 'self' }
      },
      sdkOptions: {
        users: {
          '999': { id: '999', name: 'Other User' }
        }
      }
    });

    await assert.rejects(
      async () => await handler(context, 'read', { id: '999' }),
      /403 Forbidden: Target user does not belong to an allowed user scope/
    );
  });

  await t.test('defaults omitted user_id_limitation to self for user-owned resources (even when defaultMode is honored)', async () => {
    let capturedDefaultMode: string | undefined;
    const context = createTestContext({
      userId: '42',
      parameters: {
        target_object: 'users',
        supported_operations: [{ name: 'read' }]
      },
      sdkOptions: {
        users: {
          '42': { id: '42', name: 'Current User' },
          '999': { id: '999', name: 'Other User' }
        }
      }
    });
    const origHelper = (context as any).helpers.resolveUserIdLimitation;
    (context as any).helpers.resolveUserIdLimitation = async (cfg: any, defaultMode: any) => {
      capturedDefaultMode = defaultMode;
      return origHelper(cfg, defaultMode);
    };

    await assert.rejects(
      async () => await handler(context, 'read', { id: '999' }),
      /403 Forbidden: Target user does not belong to an allowed user scope/
    );
    assert.equal(capturedDefaultMode, 'self');
  });

  await t.test('returns 403 before SDK lookup for non-existent user ID on users target', async () => {
    const context = createTestContext({
      userId: '42',
      parameters: {
        target_object: 'users',
        supported_operations: [{ name: 'read' }, { name: 'update', fields: ['first_name'] }, { name: 'delete' }]
      },
      sdkOptions: {
        users: {
          '42': { id: '42', name: 'Current User' }
        }
      }
    });

    await assert.rejects(
      async () => await handler(context, 'read', { id: 'does-not-exist' }),
      /403 Forbidden: Target user does not belong to an allowed user scope/
    );
    await assert.rejects(
      async () => await handler(context, 'update', { id: 'does-not-exist', body: { first_name: 'X' } }),
      /403 Forbidden: Target user does not belong to an allowed user scope/
    );
    await assert.rejects(
      async () => await handler(context, 'delete', { id: 'does-not-exist' }),
      /403 Forbidden: Target user does not belong to an allowed user scope/
    );

    const userLookupCalls = context.sdk.calls.filter((c: any) =>
      ['user', 'update_user', 'delete_user'].includes(c.method)
    );
    assert.equal(userLookupCalls.length, 0);
  });

  await t.test('blocks create on users when user_id_limitation is active and blocks omitted user_id when caller is out of scope', async () => {
    const usersCreateCtx = createTestContext({
      userId: '42',
      parameters: {
        target_object: 'users',
        user_id_limitation: { mode: 'self' },
        supported_operations: [{ name: 'create', fields: ['first_name', 'last_name'] }]
      }
    });

    await assert.rejects(
      async () => await handler(usersCreateCtx, 'create', { body: { first_name: 'Rogue', last_name: 'User' } }),
      /403 Forbidden: Creating "users" is not permitted when user_id_limitation is active/
    );

    const outOfScopeCtx = createTestContext({
      userId: '50',
      parameters: {
        target_object: 'scheduled_plans',
        user_id_limitation: { mode: 'scope_groups' },
        supported_operations: [{ name: 'create', fields: ['name', 'user_id'] }]
      },
      sdkOptions: {
        userGroups: { '50': ['unrelated_group'] },
        scopeGroups: { unrelated_group: [] },
        groupAttributeValues: { attr_100: [] }
      }
    });
    (outOfScopeCtx.sdk as any).create_scheduled_plan = async () => ({});

    await assert.rejects(
      async () => await handler(outOfScopeCtx, 'create', { body: { name: 'Exfil Plan', user_id: null } }),
      /403 Forbidden: Invoking user "50" is outside allowed user scope/
    );
  });
});
