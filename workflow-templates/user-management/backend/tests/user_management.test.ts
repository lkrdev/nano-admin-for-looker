import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../index';

function buildMockLookerSdk(overrides: Record<string, any> = {}) {
  const defaultAttributes = [
    { id: 'attr_scope', name: 'nano_admin_is_workflow_scope_group', label: 'Scope Group', is_system: false, value_is_hidden: false },
    { id: 'attr_chal', name: 'nano_admin_challenge', label: 'Challenge', is_system: false, value_is_hidden: true },
    { id: 'attr_sys', name: 'looker_internal_sys', label: 'System Attr', is_system: true, value_is_hidden: false },
    { id: 'attr_dept', name: 'department', label: 'Department', is_system: false, value_is_hidden: false },
    { id: 'attr_region', name: 'region', label: 'Region', is_system: false, value_is_hidden: false },
    { id: 'attr_secret', name: 'tenant_api_key', label: 'Tenant API Key', is_system: false, value_is_hidden: true },
    { id: 'attr_blocked', name: 'restricted_flag', label: 'Restricted Flag', is_system: false, value_is_hidden: false }
  ];

  const defaultUsers: Record<string, any> = {
    '100': {
      id: '100',
      first_name: 'Alice',
      last_name: 'Admin',
      display_name: 'Alice Admin',
      email: 'alice@example.com',
      is_disabled: false,
      group_ids: ['10', '20'],
      role_ids: ['r_team_lead']
    },
    '200': {
      id: '200',
      first_name: 'Bob',
      last_name: 'Member',
      display_name: 'Bob Member',
      email: 'bob@example.com',
      is_disabled: false,
      group_ids: ['10', '11'],
      role_ids: ['r_viewer', 'r_out_of_scope']
    },
    '300': {
      id: '300',
      first_name: 'Charlie',
      last_name: 'External',
      display_name: 'Charlie External',
      email: 'charlie@example.com',
      is_disabled: false,
      group_ids: ['99'],
      role_ids: ['r_viewer']
    }
  };

  const defaultGroups = [
    { id: '10', name: 'Marketing Scope Group', contains_current_user: false },
    { id: '11', name: 'Marketing Subgroup L1', contains_current_user: false },
    { id: '12', name: 'Marketing Subgroup L2', contains_current_user: false },
    { id: '20', name: 'Regular Group', contains_current_user: false },
    { id: '99', name: 'Other Scope Group', contains_current_user: false }
  ];

  const baseSdk: any = {
    ok: async (val: any) => await val,
    all_user_attributes: async () => defaultAttributes,
    all_user_attribute_group_values: async (attrId: string) => {
      if (attrId === 'attr_scope') {
        return [
          { group_id: '10', value: 'yes' },
          { group_id: '99', value: 'yes' }
        ];
      }
      if (attrId === 'attr_region') {
        return [
          { group_id: '10', value: 'NA' }
        ];
      }
      return [];
    },
    all_group_users: async (params: any) => {
      const gid = String(params.group_id);
      return Object.values(defaultUsers).filter((u: any) => (u.group_ids || []).includes(gid));
    },
    user: async (id: string) => {
      const u = defaultUsers[String(id)];
      if (!u) throw new Error(`User ${id} not found`);
      return { ...u };
    },
    all_users: async () => Object.values(defaultUsers),
    search_users: async (params: any) => {
      const all = Object.values(defaultUsers);
      if (params?.email) {
        return all.filter((u: any) => u.email.toLowerCase() === String(params.email).toLowerCase());
      }
      return [];
    },
    all_groups: async () => defaultGroups,
    search_groups_with_hierarchy: async () => [
      { id: '10', name: 'Marketing Scope Group', parent_group_ids: [] },
      { id: '11', name: 'Marketing Subgroup L1', parent_group_ids: ['10'] },
      { id: '12', name: 'Marketing Subgroup L2', parent_group_ids: ['11'] },
      { id: '20', name: 'Regular Group', parent_group_ids: [] },
      { id: '99', name: 'Other Scope Group', parent_group_ids: [] }
    ],
    user_attribute_user_values: async (params: any) => {
      const uid = String(params.user_id);
      if (uid === '100') {
        return [
          { user_attribute_id: 'attr_dept', value: 'Marketing', source: 'User' },
          { user_attribute_id: 'attr_region', value: 'NA', source: 'Group' }
        ];
      }
      if (uid === '200') {
        return [
          { user_attribute_id: 'attr_dept', value: 'Marketing', source: 'User' },
          { user_attribute_id: 'attr_secret', value: '****', source: 'User' }
        ];
      }
      return [];
    },
    all_roles: async () => [
      {
        id: 'r_admin',
        name: 'Admin',
        permission_set: { id: 'ps_admin', name: 'Admin', all_access: true, permissions: ['administer'] },
        model_set: { id: 'ms_all', name: 'All', all_access: true, models: [] }
      },
      {
        id: 'r_team_lead',
        name: 'Team Lead',
        permission_set: { id: 'ps_lead', name: 'Lead', all_access: false, permissions: ['access_data', 'see_looks', 'explore'] },
        model_set: { id: 'ms_mkt', name: 'Marketing Models', all_access: false, models: ['marketing', 'shared'] }
      },
      {
        id: 'r_viewer',
        name: 'Viewer',
        permission_set: { id: 'ps_view', name: 'Viewer', all_access: false, permissions: ['access_data', 'see_looks'] },
        model_set: { id: 'ms_mkt_sub', name: 'Marketing Only', all_access: false, models: ['marketing'] }
      },
      {
        id: 'r_out_of_scope',
        name: 'Finance Explorer',
        permission_set: { id: 'ps_fin', name: 'Finance', all_access: false, permissions: ['access_data', 'explore'] },
        model_set: { id: 'ms_fin', name: 'Finance Models', all_access: false, models: ['finance'] }
      }
    ],
    user_roles: async (params: any) => {
      const uid = String(params.user_id);
      if (uid === '100') {
        return [
          {
            id: 'r_team_lead',
            name: 'Team Lead',
            permission_set: { id: 'ps_lead', name: 'Lead', all_access: false, permissions: ['access_data', 'see_looks', 'explore'] },
            model_set: { id: 'ms_mkt', name: 'Marketing Models', all_access: false, models: ['marketing', 'shared'] }
          }
        ];
      }
      if (uid === '200') {
        return [
          { id: 'r_viewer', name: 'Viewer' },
          { id: 'r_out_of_scope', name: 'Finance Explorer' }
        ];
      }
      return [];
    },
    role_groups: async (roleId: string) => {
      if (roleId === 'r_viewer') {
        return [{ id: '10', name: 'Marketing Scope Group' }];
      }
      return [];
    },
    ...overrides
  };

  return baseSdk;
}

function makeContext(sdk: any, parameters: any, userId: string = '100') {
  return {
    sdk,
    userId,
    workflowId: 'test-um-wf',
    parameters,
    instanceHost: 'test.looker.app'
  };
}

test('user-management: list_users & get_user_detail enforce Scope Group boundaries', async () => {
  const sdk = buildMockLookerSdk();
  const params = {
    user_id_limitation: { mode: 'scope_groups', attribute_name: 'nano_admin_is_workflow_scope_group' }
  };
  const ctx = makeContext(sdk, params, '100');

  // 1. list_users returns only users in Scope Group '10' (100 and 200), excluding '300' (in group 99)
  const listRes = await handler(ctx, 'list_users', {});
  const listedIds = listRes.users.map((u: any) => u.id).sort();
  assert.deepEqual(listedIds, ['100', '200']);

  // 2. get_user_detail succeeds for in-scope user '200'
  const detailOkRes = await handler(ctx, 'get_user_detail', { user_id: '200' });
  assert.equal(detailOkRes.user.id, '200');

  // 3. get_user_detail rejects out-of-scope user '300'
  await assert.rejects(
    async () => await handler(ctx, 'get_user_detail', { user_id: '300' }),
    /403 Forbidden: Target user "300" does not belong to an allowed user scope/i
  );
});

test('user-management: create_user pre-checks duplicates, enforces Scope Group assignment, and preserves user in Scope Group on partial failure', async () => {
  const addedGroups: Array<{ groupId: string; userId: string }> = [];
  const sdk = buildMockLookerSdk({
    create_user: async (body: any) => ({
      id: '500',
      first_name: body.first_name,
      last_name: body.last_name,
      display_name: `${body.first_name} ${body.last_name}`,
      email: ''
    }),
    add_group_user: async (groupId: string, body: any) => {
      addedGroups.push({ groupId: String(groupId), userId: String(body.user_id) });
      return {};
    },
    set_user_attribute_user_value: async () => ({}),
    create_user_credentials_email: async () => {
      throw new Error('Simulated email credential creation failure');
    }
  });

  const params = {
    profile: { allow_create: true },
    credentials: { allow_email_credentials: true },
    user_attributes: {
      allow_edit: true,
      allowed_attributes: [
        { name: 'department', rule: 'must_match_admin' }
      ]
    }
  };
  const ctx = makeContext(sdk, params, '100');

  // 1. Pre-check rejects duplicate email (bob@example.com already exists)
  await assert.rejects(
    async () =>
      await handler(ctx, 'create_user', {
        first_name: 'Bob',
        last_name: 'Twin',
        email: 'bob@example.com',
        group_ids: ['10']
      }),
    /already exists/i
  );

  // 2. Rejects creation if no active Scope Group is selected
  await assert.rejects(
    async () =>
      await handler(ctx, 'create_user', {
        first_name: 'New',
        last_name: 'User',
        email: 'new@example.com',
        group_ids: ['11'] // '11' is a subgroup, not active scope group '10'
      }),
    /assigned to at least one of the invoking admin's active Scope Groups/i
  );

  // 3. Creates user, immediately adds to Scope Group '10', enforces must_match_admin attribute, and returns warning (no rollback) when email credential fails
  const partialRes = await handler(ctx, 'create_user', {
    first_name: 'New',
    last_name: 'User',
    email: 'new@example.com',
    group_ids: ['10']
  });
  assert.equal(partialRes.user.id, '500');
  assert.deepEqual(addedGroups, [{ groupId: '10', userId: '500' }]);
  assert.equal(partialRes.warnings.length, 1);
  assert.match(partialRes.warnings[0], /Simulated email credential creation failure/);
});

test('user-management: create_user enforces groups.allow_edit in both scope_groups and non-scope_groups modes', async () => {
  const addedGroups: string[] = [];
  const sdk = buildMockLookerSdk({
    create_user: async (body: any) => ({
      id: '501',
      first_name: body.first_name,
      last_name: body.last_name,
      is_disabled: body.is_disabled
    }),
    add_group_user: async (gid: string) => {
      addedGroups.push(String(gid));
      return {};
    }
  });

  // 1. In scope_groups_minus_privileged mode with groups.allow_edit: false,
  //    active Scope Group '10' is allowed, but child subgroup '11' is rejected with 403.
  const scopeCtx = makeContext(
    sdk,
    {
      profile: { allow_create: true },
      groups: { allow_view: true, allow_edit: false }
    },
    '100'
  );

  await assert.rejects(
    async () =>
      await handler(scopeCtx, 'create_user', {
        first_name: 'Sub',
        last_name: 'Escalator',
        email: 'sub@example.com',
        group_ids: ['10', '11']
      }),
    /403 Forbidden: Assigning group "11" is not permitted when groups\.allow_edit is disabled/i
  );

  const scopeCreateRes = await handler(scopeCtx, 'create_user', {
    first_name: 'Scoped',
    last_name: 'User',
    email: 'scoped@example.com',
    group_ids: ['10']
  });
  assert.equal(scopeCreateRes.user.id, '501');
  assert.deepEqual(addedGroups, ['10']);

  // 2. In exclude_privileged mode with groups.allow_edit: false,
  //    any non-empty group_ids is rejected with 403, while empty group_ids succeeds.
  const nonScopeCtx = makeContext(
    sdk,
    {
      user_id_limitation: { mode: 'exclude_privileged' },
      profile: { allow_create: true },
      groups: { allow_view: true, allow_edit: false }
    },
    '100'
  );

  await assert.rejects(
    async () =>
      await handler(nonScopeCtx, 'create_user', {
        first_name: 'Admin',
        last_name: 'Escalator',
        email: 'adminesc@example.com',
        group_ids: ['10']
      }),
    /403 Forbidden: Assigning groups upon user creation is not permitted when groups\.allow_edit is disabled/i
  );

  const nonScopeCreateRes = await handler(nonScopeCtx, 'create_user', {
    first_name: 'Plain',
    last_name: 'User',
    email: 'plain@example.com',
    group_ids: []
  });
  assert.equal(nonScopeCreateRes.user.id, '501');
});

test('user-management: groups allows multi-hop subgroups, blocks external groups, and warns when removing from final Scope Group', async () => {
  const sdk = buildMockLookerSdk({
    add_group_user: async () => ({}),
    delete_group_user: async () => ({})
  });

  const params = {
    groups: { allow_view: true, allow_edit: true }
  };
  const ctx = makeContext(sdk, params, '100');

  // 1. get_user_groups resolves Scope Group '10' plus multi-hop subgroups '11' (d=1) and '12' (d=2)
  const getRes = await handler(ctx, 'get_user_groups', { user_id: '200' });
  const manageableIds = getRes.manageable_groups.map((g: any) => g.id);
  assert.deepEqual(manageableIds, ['10', '11', '12']);

  // 2. Adding user to 2-hop child group '12' succeeds
  const addChildRes = await handler(ctx, 'add_user_to_group', { user_id: '200', group_id: '12' });
  assert.equal(addChildRes.success, true);

  // 3. Adding user to external group '20' or '99' is rejected
  await assert.rejects(
    async () => await handler(ctx, 'add_user_to_group', { user_id: '200', group_id: '20' }),
    /403 Forbidden: Group "20" is not a member of the invoking admin's Scope Group hierarchy/i
  );

  // 4. Removing user '200' from their only shared Scope Group '10' succeeds AND returns removed_from_final_scope_group warning
  const remFinalRes = await handler(ctx, 'remove_user_from_group', { user_id: '200', group_id: '10' });
  assert.equal(remFinalRes.removed_from_final_scope_group, true);
  assert.match(remFinalRes.warning, /removed from their final shared Scope Group/i);
});

test('user-management: roles enforces admin permission/model subset, blocks Admin role, and preserves out-of-scope direct roles', async () => {
  let savedRoleIds: string[] = [];
  const sdk = buildMockLookerSdk({
    set_user_roles: async (_uid: string, roleIds: string[]) => {
      savedRoleIds = roleIds;
      return [];
    }
  });

  const params = {
    roles: { allow_view: true, allow_edit: true }
  };
  const ctx = makeContext(sdk, params, '100');

  // 1. get_user_roles marks r_viewer and r_team_lead as assignable, and r_admin / r_out_of_scope as not assignable
  const rolesRes = await handler(ctx, 'get_user_roles', { user_id: '200' });
  const roleMap = new Map<string, any>(rolesRes.roles.map((r: any) => [r.id, r]));
  assert.equal(roleMap.get('r_admin')?.assignable, false);
  assert.equal(roleMap.get('r_out_of_scope')?.assignable, false);
  assert.equal(roleMap.get('r_viewer')?.assignable, true);
  assert.equal(roleMap.get('r_team_lead')?.assignable, true);

  // 2. Attempting to assign r_admin is blocked
  await assert.rejects(
    async () => await handler(ctx, 'set_user_roles', { user_id: '200', role_ids: ['r_admin'] }),
    /403 Forbidden: Assigning Admin role "Admin" is strictly prohibited/i
  );

  // 3. Updating assignable roles on user '200' preserves their existing out-of-scope direct role ('r_out_of_scope')
  const setOkRes = await handler(ctx, 'set_user_roles', { user_id: '200', role_ids: ['r_team_lead'] });
  assert.equal(setOkRes.success, true);
  assert.deepEqual(savedRoleIds.sort(), ['r_out_of_scope', 'r_team_lead'].sort());
});

test('user-management: user_attributes hard-blocks system/challenge/scope attributes, respects blocked_attributes precedence, and allows hidden attributes', async () => {
  const writtenAttrs: Array<{ userId: string; attrId: string; value: string }> = [];
  const sdk = buildMockLookerSdk({
    set_user_attribute_user_value: async (userId: string, attrId: string, body: { value: string }) => {
      writtenAttrs.push({ userId, attrId, value: body.value });
      return {};
    }
  });

  const params = {
    user_attributes: {
      allow_view: true,
      allow_edit: true,
      blocked_attributes: ['restricted_flag'],
      allowed_attributes: [
        { name: 'restricted_flag', rule: 'any' }, // Should still be blocked because blocked_attributes wins!
        { name: 'department', rule: 'must_match_admin' },
        { name: 'region', rule: 'must_match_scope_group' },
        { name: 'tenant_api_key', rule: 'any' } // value_is_hidden: true
      ]
    }
  };
  const ctx = makeContext(sdk, params, '100');

  // 1. Hard-blocked challenge attribute is rejected
  await assert.rejects(
    async () =>
      await handler(ctx, 'set_user_attribute', {
        user_id: '200',
        attribute_id: 'attr_chal',
        value: 'hacked'
      }),
    /not found or is blocked/i
  );

  // 2. blocked_attributes takes precedence over allowed_attributes
  await assert.rejects(
    async () =>
      await handler(ctx, 'set_user_attribute', {
        user_id: '200',
        attribute_id: 'attr_blocked',
        value: 'yes'
      }),
    /403 Forbidden: User attribute "restricted_flag" is not editable in this workflow/i
  );

  // 3. must_match_admin rejects value that does not match admin's value ('Marketing')
  await assert.rejects(
    async () =>
      await handler(ctx, 'set_user_attribute', {
        user_id: '200',
        attribute_id: 'attr_dept',
        value: 'Sales'
      }),
    /must match the invoking admin's value/i
  );

  // 4. must_match_scope_group allows value matching Scope Group '10' ('NA') and rejects 'EU'
  await assert.rejects(
    async () =>
      await handler(ctx, 'set_user_attribute', {
        user_id: '200',
        attribute_id: 'attr_region',
        value: 'EU'
      }),
    /must match one of the active Scope Group values/i
  );

  const matchGroupRes = await handler(ctx, 'set_user_attribute', {
    user_id: '200',
    attribute_id: 'attr_region',
    value: 'NA'
  });
  assert.equal(matchGroupRes.success, true);

  // 5. Hidden attribute (value_is_hidden: true) is allowed to be written when in allowed_attributes
  const hiddenOkRes = await handler(ctx, 'set_user_attribute', {
    user_id: '200',
    attribute_id: 'attr_secret',
    value: 'new-secret-token-123'
  });
  assert.equal(hiddenOkRes.success, true);
  assert.ok(writtenAttrs.some((w) => w.attrId === 'attr_secret' && w.value === 'new-secret-token-123'));
});

test('user-management: folder_access scopes folders to Scope Group grants + descendants and caps permissions', async () => {
  const sdk = buildMockLookerSdk({
    all_folders: async () => [
      { id: 'f_root', name: 'Shared', parent_id: null, content_metadata_id: 'cm_root' },
      { id: 'f_mkt', name: 'Marketing Root', parent_id: 'f_root', content_metadata_id: 'cm_mkt' },
      { id: 'f_mkt_sub', name: 'Marketing Campaigns', parent_id: 'f_mkt', content_metadata_id: 'cm_mkt_sub' },
      { id: 'f_fin', name: 'Finance Root', parent_id: 'f_root', content_metadata_id: 'cm_fin' }
    ],
    all_content_metadata_accesses: async (arg: any) => {
      const cmId = typeof arg === 'string' ? arg : String(arg?.content_metadata_id || '');
      if (cmId === 'cm_mkt') {
        // Scope group '10' has 'view' only on Marketing Root
        return [{ id: 'acc_1', content_metadata_id: 'cm_mkt', group_id: '10', permission_type: 'view' }];
      }
      if (cmId === 'cm_mkt_sub') {
        return [{ id: 'acc_2', content_metadata_id: 'cm_mkt_sub', group_id: '10', permission_type: 'view' }];
      }
      return [];
    },
    content_metadata: async (cmId: string) => {
      if (cmId === 'cm_mkt') return { id: 'cm_mkt', inherits: false };
      if (cmId === 'cm_mkt_sub') return { id: 'cm_mkt_sub', inherits: true }; // Inherits from parent!
      return { id: cmId, inherits: false };
    },
    create_content_metadata_access: async () => ({ id: 'acc_new' })
  });

  const params = {
    folder_access: { allow_view: true, allow_edit: true }
  };
  const ctx = makeContext(sdk, params, '100');

  // 1. get_user_folder_access returns only f_mkt and its descendant f_mkt_sub (excludes f_fin)
  const listRes = await handler(ctx, 'get_user_folder_access', { user_id: '200' });
  const folderIds = listRes.folders.map((f: any) => f.folder_id).sort();
  assert.deepEqual(folderIds, ['f_mkt', 'f_mkt_sub']);

  // 2. Granting 'edit' on f_mkt fails because Scope Group '10' only holds 'view'
  await assert.rejects(
    async () =>
      await handler(ctx, 'set_user_folder_access', {
        user_id: '200',
        folder_id: 'f_mkt',
        permission_type: 'edit'
      }),
    /403 Forbidden: Cannot grant "edit" access on folder "Marketing Root"/i
  );

  // 3. Granting 'view' on f_mkt_sub fails because f_mkt_sub has inherits: true
  await assert.rejects(
    async () =>
      await handler(ctx, 'set_user_folder_access', {
        user_id: '200',
        folder_id: 'f_mkt_sub',
        permission_type: 'view'
      }),
    /400 Bad Request: Folder "Marketing Campaigns" inherits its access settings from a parent folder/i
  );

  // 4. Granting 'view' on f_mkt (inherits: false, within cap) succeeds
  const okRes = await handler(ctx, 'set_user_folder_access', {
    user_id: '200',
    folder_id: 'f_mkt',
    permission_type: 'view'
  });
  assert.equal(okRes.success, true);
});

test('user-management: folder_access does not propagate scope to detached (inherits: false) subfolders', async () => {
  let createCalls = 0;
  const sdk = buildMockLookerSdk({
    all_folders: async () => [
      { id: 'f_mkt', name: 'Marketing Root', parent_id: null, content_metadata_id: 'cm_mkt' },
      { id: 'f_private', name: 'HR Private', parent_id: 'f_mkt', content_metadata_id: 'cm_private' },
      { id: 'f_private_sub', name: 'HR Private Child', parent_id: 'f_private', content_metadata_id: 'cm_private_sub' }
    ],
    all_content_metadata_accesses: async (arg: any) => {
      const cmId = typeof arg === 'string' ? arg : String(arg?.content_metadata_id || '');
      if (cmId === 'cm_mkt') {
        return [{ id: 'acc_1', content_metadata_id: 'cm_mkt', group_id: '10', permission_type: 'edit' }];
      }
      return [];
    },
    content_metadata: async (cmId: string) => {
      if (cmId === 'cm_private_sub') return { id: 'cm_private_sub', inherits: true };
      return { id: cmId, inherits: false };
    },
    create_content_metadata_access: async () => {
      createCalls++;
      return { id: 'acc_new' };
    }
  });

  const ctx = makeContext(sdk, { folder_access: { allow_view: true, allow_edit: true } }, '100');

  const listRes = await handler(ctx, 'get_user_folder_access', { user_id: '200' });
  assert.deepEqual(
    listRes.folders.map((f: any) => f.folder_id),
    ['f_mkt']
  );

  await assert.rejects(
    async () =>
      await handler(ctx, 'set_user_folder_access', {
        user_id: '200',
        folder_id: 'f_private',
        permission_type: 'edit'
      }),
    /403 Forbidden/i
  );

  assert.equal(createCalls, 0);
});

test('user-management: schedule actions fail closed on orphaned/system schedules without owner', async () => {
  let updateCalls = 0;
  let deleteCalls = 0;
  const sdk = buildMockLookerSdk({
    scheduled_plan: async (planId: string) => ({
      id: planId,
      name: 'Orphaned System Plan',
      user_id: null,
      user: null
    }),
    update_scheduled_plan: async () => {
      updateCalls++;
      return {};
    },
    delete_scheduled_plan: async () => {
      deleteCalls++;
      return {};
    }
  });

  const ctx = makeContext(sdk, {
    user_id_limitation: { mode: 'scope_groups_minus_privileged' },
    telemetry: { allow_manage_schedules: true }
  }, '100');

  await assert.rejects(
    async () =>
      await handler(ctx, 'reassign_user_schedule', {
        user_id: '200',
        new_owner_user_id: '200',
        scheduled_plan_id: 'orphaned_plan_123'
      }),
    /403 Forbidden: Scheduled plan orphaned_plan_123 does not belong to user 200/
  );

  await assert.rejects(
    async () =>
      await handler(ctx, 'delete_user_schedule', {
        user_id: '200',
        scheduled_plan_id: 'orphaned_plan_123'
      }),
    /403 Forbidden: Deleting scheduled plans is disabled/
  );

  assert.equal(updateCalls, 0);
  assert.equal(deleteCalls, 0);
});

test('user-management: schedule mutations only allow disabling and reassigning (disabling + returning review_url)', async () => {
  const updateCalls: Array<{ id: string; body: any }> = [];
  const sdk = buildMockLookerSdk({
    scheduled_plan: async (id: string) => ({
      id,
      user_id: '100',
      dashboard_id: '42',
      enabled: true
    }),
    update_scheduled_plan: async (id: string, body: any) => {
      updateCalls.push({ id: String(id), body });
      return { id, ...body };
    }
  });

  const ctx = makeContext(sdk, { telemetry: { allow_manage_schedules: true } }, '100');

  // 1. Enabling a schedule is blocked
  await assert.rejects(
    async () =>
      await handler(ctx, 'update_user_schedule', {
        user_id: '100',
        scheduled_plan_id: 'sp_1',
        enabled: true
      }),
    /403 Forbidden: Enabling scheduled plans is disabled/
  );

  // 2. Disabling a schedule succeeds
  const disableRes = await handler(ctx, 'update_user_schedule', {
    user_id: '100',
    scheduled_plan_id: 'sp_1',
    enabled: false
  });
  assert.equal(disableRes.enabled, false);

  // 3. Reassigning a schedule forces enabled: false and returns review_url
  const reassignRes = await handler(ctx, 'reassign_user_schedule', {
    user_id: '100',
    new_owner_user_id: '200',
    scheduled_plan_id: 'sp_1'
  });
  assert.equal(reassignRes.enabled, false);
  assert.equal(reassignRes.review_url, 'https://test.looker.app/dashboards/42');
  assert.deepEqual(updateCalls[1], {
    id: 'sp_1',
    body: { user_id: '200', enabled: false }
  });
});

test('user-management: roles prevents cross-role permission+model flattening escalation', async () => {
  let setRolesCalls = 0;
  const sdk = buildMockLookerSdk({
    all_users: async () => [
      {
        id: '100',
        first_name: 'Alice',
        last_name: 'Admin',
        display_name: 'Alice Admin',
        email: 'alice@example.com',
        is_disabled: false,
        is_service_account: false,
        group_ids: ['10'],
        role_ids: ['r_dev_sandbox', 'r_explore_prod']
      },
      {
        id: '200',
        first_name: 'Bob',
        last_name: 'User',
        display_name: 'Bob User',
        email: 'bob@example.com',
        is_disabled: false,
        is_service_account: false,
        group_ids: ['10'],
        role_ids: []
      }
    ],
    all_roles: async () => [
      {
        id: 'r_dev_sandbox',
        name: 'Dev Sandbox',
        permission_set: { permissions: ['develop'] },
        model_set: { models: ['sandbox_model'], all_access: false }
      },
      {
        id: 'r_explore_prod',
        name: 'Explore Prod',
        permission_set: { permissions: ['explore'] },
        model_set: { models: ['production_model'], all_access: false }
      },
      {
        id: 'r_dev_prod',
        name: 'Dev Prod',
        permission_set: { permissions: ['develop'] },
        model_set: { models: ['production_model'], all_access: false }
      }
    ],
    set_user_roles: async () => {
      setRolesCalls++;
      return [];
    }
  });

  const ctx = makeContext(sdk, { roles: { allow_view: true, allow_edit: true } }, '100');
  const getRes = await handler(ctx, 'get_user_roles', { user_id: '200' });
  const devProdRole = getRes.roles.find((r: any) => r.id === 'r_dev_prod');
  assert.equal(devProdRole.assignable, false);

  await assert.rejects(
    async () => await handler(ctx, 'set_user_roles', { user_id: '200', role_ids: ['r_dev_prod'] }),
    /403 Forbidden/i
  );

  assert.equal(setRolesCalls, 0);
});

test('user-management: user_attributes deletion requires allow_delete and defaults to false on rule objects', async () => {
  let deleteCalls = 0;
  const sdk = buildMockLookerSdk({
    all_user_attributes: async () => [
      { id: 'attr_scope', name: 'nano_admin_is_workflow_scope_group', is_system: false, value_is_hidden: false },
      { id: 'ua_plain', name: 'timezone', label: 'Timezone', type: 'string', is_system: false, value_is_hidden: false },
      { id: 'ua_any_rule', name: 'dept', label: 'Department', type: 'string', is_system: false, value_is_hidden: false },
      { id: 'ua_restricted', name: 'access_level', label: 'Access Level', type: 'string', is_system: false, value_is_hidden: false },
      { id: 'ua_opt_in', name: 'region', label: 'Region', type: 'string', is_system: false, value_is_hidden: false }
    ],
    delete_user_attribute_user_value: async () => {
      deleteCalls++;
      return {};
    }
  });

  // 1. Default allow_delete (false) blocks all attribute deletions
  const ctxNoDelete = makeContext(sdk, {
    user_attributes: {
      allow_view: true,
      allow_edit: true,
      allowed_attributes: ['timezone', { name: 'region', rule: 'allowed_values', values: ['US'], allow_delete: true }]
    }
  }, '100');

  await assert.rejects(
    async () => await handler(ctxNoDelete, 'delete_user_attribute', { user_id: '200', attribute_id: 'ua_plain' }),
    /403 Forbidden: Deleting user attribute overrides is not permitted/i
  );
  await assert.rejects(
    async () => await handler(ctxNoDelete, 'delete_user_attribute', { user_id: '200', attribute_id: 'ua_opt_in' }),
    /403 Forbidden: Deleting user attribute overrides is not permitted/i
  );
  assert.equal(deleteCalls, 0);

  // 2. With user_attributes.allow_delete: true, rule objects still default allow_delete to false (even rule: 'any')
  const ctxWithDelete = makeContext(sdk, {
    user_attributes: {
      allow_view: true,
      allow_edit: true,
      allow_delete: true,
      allowed_attributes: [
        'timezone',
        { name: 'dept', rule: 'any' },
        { name: 'access_level', rule: 'allowed_values', values: ['read-only'] },
        { name: 'region', rule: 'allowed_values', values: ['US'], allow_delete: true }
      ]
    }
  }, '100');

  await assert.rejects(
    async () => await handler(ctxWithDelete, 'delete_user_attribute', { user_id: '200', attribute_id: 'ua_any_rule' }),
    /403 Forbidden: Clearing user attribute "dept" is not permitted/i
  );
  await assert.rejects(
    async () => await handler(ctxWithDelete, 'delete_user_attribute', { user_id: '200', attribute_id: 'ua_restricted' }),
    /403 Forbidden: Clearing user attribute "access_level" is not permitted/i
  );

  // Plain string entry & explicit allow_delete: true rule succeed
  await handler(ctxWithDelete, 'delete_user_attribute', { user_id: '200', attribute_id: 'ua_plain' });
  await handler(ctxWithDelete, 'delete_user_attribute', { user_id: '200', attribute_id: 'ua_opt_in' });
  assert.equal(deleteCalls, 2);
});

test('user-management: create_user enforces restricted user_attributes (allowed_values / must_match_scope_group) when omitted or empty', async () => {
  let createUserCalls = 0;
  const sdk = buildMockLookerSdk({
    all_user_attributes: async () => [
      { id: 'attr_scope', name: 'nano_admin_is_workflow_scope_group', is_system: false, value_is_hidden: false },
      { id: 'ua_role', name: 'access_level', label: 'Access Level', type: 'string', is_system: false, value_is_hidden: false },
      { id: 'ua_tenant', name: 'tenant', label: 'Tenant', type: 'string', is_system: false, value_is_hidden: false }
    ],
    all_user_attribute_group_values: async (attrId: string) => {
      if (attrId === 'attr_scope' || attrId === 'attr_100') {
        return [{ group_id: '10', value: 'yes' }];
      }
      if (attrId === 'ua_tenant') {
        return [{ group_id: '10', value: 'acme' }];
      }
      return [];
    },
    create_user: async () => {
      createUserCalls++;
      return { id: '501' };
    }
  });

  const ctx = makeContext(sdk, {
    profile: { allow_create: true },
    user_attributes: {
      allow_edit: true,
      allowed_attributes: [
        { name: 'access_level', rule: 'allowed_values', values: ['read-only'] },
        { name: 'tenant', rule: 'must_match_scope_group' }
      ]
    }
  }, '100');

  // 1. Omitted restricted attribute is rejected before user creation
  await assert.rejects(
    async () =>
      await handler(ctx, 'create_user', {
        first_name: 'New',
        last_name: 'User',
        email: 'newuser@example.com',
        group_ids: ['10'],
        user_attributes: { tenant: 'acme' }
      }),
    /400 Bad Request: User attribute "access_level" is restricted \(allowed_values\) and requires a valid value/i
  );

  // 2. Empty string for restricted attribute is rejected (403) when "" is not in allowed_values
  await assert.rejects(
    async () =>
      await handler(ctx, 'create_user', {
        first_name: 'New',
        last_name: 'User',
        email: 'newuser@example.com',
        group_ids: ['10'],
        user_attributes: { access_level: 'read-only', tenant: '' }
      }),
    /403 Forbidden: Value "" for user attribute "tenant" must match/i
  );

  assert.equal(createUserCalls, 0);

  // 3. Valid values for all restricted attributes succeed
  const res = await handler(ctx, 'create_user', {
    first_name: 'New',
    last_name: 'User',
    email: 'newuser@example.com',
    group_ids: ['10'],
    user_attributes: { access_level: 'read-only', tenant: 'acme' }
  });
  assert.equal(res.user.id, '501');
  assert.equal(createUserCalls, 1);
});

test('user-management: default scope_groups_minus_privileged excludes Looker Admins and Service Accounts in Scope Group', async () => {
  const sdk = buildMockLookerSdk({
    all_users: async () => [
      {
        id: '100',
        first_name: 'Alice',
        last_name: 'Admin',
        display_name: 'Alice Admin',
        email: 'alice@example.com',
        is_disabled: false,
        is_service_account: false,
        group_ids: ['10'],
        role_ids: ['r_team_lead']
      },
      {
        id: '200',
        first_name: 'Bob',
        last_name: 'Member',
        display_name: 'Bob Member',
        email: 'bob@example.com',
        is_disabled: false,
        is_service_account: false,
        group_ids: ['10'],
        role_ids: ['r_viewer']
      },
      {
        id: '901',
        first_name: 'Super',
        last_name: 'Admin',
        display_name: 'Super Admin',
        email: 'super@example.com',
        is_disabled: false,
        is_service_account: false,
        group_ids: ['10'],
        role_ids: ['r_admin']
      },
      {
        id: '902',
        first_name: 'Automation',
        last_name: 'Service',
        display_name: 'Automation Service',
        email: 'bot@example.com',
        is_disabled: false,
        is_service_account: true,
        group_ids: ['10'],
        role_ids: ['r_viewer']
      }
    ],
    all_group_users: async (params: any) => {
      if (String(params.group_id) === '10') {
        return [
          { id: '100', group_ids: ['10'], role_ids: ['r_team_lead'], is_service_account: false },
          { id: '200', group_ids: ['10'], role_ids: ['r_viewer'], is_service_account: false },
          { id: '901', group_ids: ['10'], role_ids: ['r_admin'], is_service_account: false },
          { id: '902', group_ids: ['10'], role_ids: ['r_viewer'], is_service_account: true }
        ];
      }
      return [];
    }
  });

  // Default parameters (uses scope_groups_minus_privileged)
  const ctx = makeContext(sdk, {}, '100');

  const listRes = await handler(ctx, 'list_users', {});
  const listedIds = listRes.users.map((u: any) => u.id).sort();
  assert.deepEqual(listedIds, ['100', '200']);

  // Attempting to inspect Looker Admin ('901') or Service Account ('902') in Scope Group '10' is rejected
  await assert.rejects(
    async () => await handler(ctx, 'get_user_detail', { user_id: '901' }),
    /403 Forbidden: Target user "901" does not belong to an allowed user scope/i
  );
  await assert.rejects(
    async () => await handler(ctx, 'get_user_detail', { user_id: '902' }),
    /403 Forbidden: Target user "902" does not belong to an allowed user scope/i
  );
});

test('user-management: resolveManageableGroupHierarchy & add_user_to_group block role-escalating groups and self mode', async () => {
  const addedMemberships: string[] = [];
  const sdk = buildMockLookerSdk({
    all_groups: async () => [
      { id: '10', name: 'Marketing Scope Group' },
      { id: '11', name: 'Marketing Subgroup Safe' },
      { id: '12', name: 'Marketing Subgroup Admin' },
      { id: '13', name: 'Marketing Subgroup Elevated' },
      { id: '2', name: 'Looker Admins' }
    ],
    search_groups_with_hierarchy: async () => [
      { id: '10', name: 'Marketing Scope Group', parent_group_ids: [], role_ids: [] },
      { id: '11', name: 'Marketing Subgroup Safe', parent_group_ids: ['10'], role_ids: ['r_viewer'] },
      { id: '12', name: 'Marketing Subgroup Admin', parent_group_ids: ['10'], role_ids: ['r_admin'] },
      { id: '13', name: 'Marketing Subgroup Elevated', parent_group_ids: ['10'], role_ids: ['r_out_of_scope'] },
      { id: '2', name: 'Looker Admins', parent_group_ids: [], role_ids: ['r_admin'] }
    ],
    add_group_user: async (gid: string, body: any) => {
      addedMemberships.push(`${gid}:${body.user_id}`);
      return {};
    }
  });

  // 1. In scope_groups_minus_privileged mode: safe subgroup '11' is manageable; '12' (Admin) & '13' (elevated) are excluded with clear 403 reason
  const ctx = makeContext(sdk, { groups: { allow_view: true, allow_edit: true } }, '100');
  const groupsRes = await handler(ctx, 'get_user_groups', { user_id: '200' });
  const manageableIds = groupsRes.manageable_groups.map((g: any) => g.id).sort();
  assert.deepEqual(manageableIds, ['10', '11']);

  await assert.rejects(
    async () => await handler(ctx, 'add_user_to_group', { user_id: '100', group_id: '12' }),
    /403 Forbidden: Group "12" cannot be assigned because it grants a Looker Admin role/i
  );
  await assert.rejects(
    async () => await handler(ctx, 'add_user_to_group', { user_id: '100', group_id: '13' }),
    /403 Forbidden: Group "13" cannot be assigned because it grants Looker role .* exceeding your permissions or model access/i
  );

  // Safe subgroup '11' succeeds
  await handler(ctx, 'add_user_to_group', { user_id: '200', group_id: '11' });
  assert.deepEqual(addedMemberships, ['11:200']);

  // 2. In exclude_privileged mode: Looker Admins group '2' is excluded and blocked
  const exclCtx = makeContext(
    sdk,
    {
      user_id_limitation: { mode: 'exclude_privileged' },
      groups: { allow_view: true, allow_edit: true }
    },
    '100'
  );
  const exclGroupsRes = await handler(exclCtx, 'get_user_groups', { user_id: '200' });
  assert.equal(exclGroupsRes.manageable_groups.some((g: any) => g.id === '2'), false);
  await assert.rejects(
    async () => await handler(exclCtx, 'add_user_to_group', { user_id: '100', group_id: '2' }),
    /403 Forbidden: Group "2" cannot be assigned because it grants a Looker Admin role/i
  );

  // 3. In self mode: no groups are manageable and add_user_to_group is rejected
  const selfCtx = makeContext(
    sdk,
    {
      user_id_limitation: { mode: 'self' },
      groups: { allow_view: true, allow_edit: true }
    },
    '100'
  );
  const selfGroupsRes = await handler(selfCtx, 'get_user_groups', { user_id: '100' });
  assert.deepEqual(selfGroupsRes.manageable_groups, []);
  await assert.rejects(
    async () => await handler(selfCtx, 'add_user_to_group', { user_id: '100', group_id: '10' }),
    /403 Forbidden: Group "10" is not a member of the invoking admin's Scope Group hierarchy/i
  );
});

test('user-management: create_email_credentials & delete_email_credentials enforce allow_update_email', async () => {
  const sdk = buildMockLookerSdk({
    user: async (id: string) => {
      if (String(id) === '200') {
        return { id: '200', email: '', group_ids: ['10'] };
      }
      return { id: String(id), email: 'existing@example.com', group_ids: ['10'] };
    },
    create_user_credentials_email: async () => ({}),
    delete_user_credentials_email: async () => ({})
  });

  // Default profile.allow_update_email is false even when allow_email_credentials is true
  const ctx = makeContext(
    sdk,
    {
      credentials: { allow_email_credentials: true }
    },
    '100'
  );

  // Blocked: attaching an email to an email-less user ('200') when allow_update_email is false
  await assert.rejects(
    async () =>
      await handler(ctx, 'create_email_credentials', {
        user_id: '200',
        email: 'attacker@evil.com'
      }),
    /403 Forbidden: Setting or changing a user's email address is not permitted/i
  );

  // Blocked: deleting email credentials when allow_update_email is false
  await assert.rejects(
    async () => await handler(ctx, 'delete_email_credentials', { user_id: '100' }),
    /403 Forbidden: Deleting email credentials is not permitted/i
  );

  // Allowed: when profile.allow_update_email is true
  const allowCtx = makeContext(
    sdk,
    {
      profile: { allow_update_email: true },
      credentials: { allow_email_credentials: true }
    },
    '100'
  );
  const res = await handler(allowCtx, 'create_email_credentials', {
    user_id: '200',
    email: 'valid@example.com'
  });
  assert.equal(res.success, true);
});

test('user-management: create_user duplicate check rejects wildcards, ignores _ wildcard false matches, and omits user IDs', async () => {
  let allUsersCalls = 0;
  const sdk = buildMockLookerSdk({
    all_users: async () => {
      allUsersCalls++;
      return [];
    },
    search_users: async (params: any) => {
      // Simulate Looker SQL LIKE '_' matching bob@example.com when searching b_b@example.com
      if (params?.email === 'b_b@example.com' || params?.email === 'bob@example.com') {
        return [{ id: '200', email: 'bob@example.com' }];
      }
      return [];
    },
    create_user: async (body: any) => ({
      id: '502',
      first_name: body.first_name,
      last_name: body.last_name
    }),
    add_group_user: async () => ({})
  });

  const ctx = makeContext(sdk, { profile: { allow_create: true } }, '100');

  // 1. Cross-domain email is rejected with 403 before search_users is called
  let searchCalls = 0;
  const origSearchUsers = sdk.search_users;
  sdk.search_users = async (p: any) => {
    searchCalls++;
    return origSearchUsers(p);
  };
  await assert.rejects(
    async () =>
      await handler(ctx, 'create_user', {
        first_name: 'External',
        email: 'ceo@other-tenant.com',
        group_ids: ['10']
      }),
    /403 Forbidden: Created user email domain must match/
  );
  assert.equal(searchCalls, 0);

  // 2. '%' wildcard in email is rejected as 400 Bad Request
  await assert.rejects(
    async () =>
      await handler(ctx, 'create_user', {
        first_name: 'Probe',
        email: 'b%b@example.com',
        group_ids: ['10']
      }),
    /400 Bad Request: A valid email address is required/
  );

  // 2. Exact match throws 409 without leaking user ID
  await assert.rejects(
    async () =>
      await handler(ctx, 'create_user', {
        first_name: 'Bob',
        email: 'bob@example.com',
        group_ids: ['10']
      }),
    (err: any) =>
      /409 Conflict: A user with this email already exists/.test(err?.message || '') &&
      !/200/.test(err?.message || '')
  );

  // 3. Underscore in valid email (b_b@example.com) ignores Looker's wildcard match for bob@example.com
  allUsersCalls = 0;
  const okRes = await handler(ctx, 'create_user', {
    first_name: 'Underscore',
    email: 'b_b@example.com',
    group_ids: ['10']
  });
  assert.equal(okRes.user.id, '502');
  // Assert all_users was only called once by scope resolution, never by assertUserDoesNotExist
  assert.equal(allUsersCalls, 1);
});

test('user-management: update_user_profile and set_user_disabled request fields=id and strip sensitive user metadata', async () => {
  const capturedFields: Array<{ op: string; fields?: string }> = [];
  const sensitiveUser = {
    id: '200',
    first_name: 'Bob',
    last_name: 'Builder',
    email: 'bob@example.com',
    sessions: [{ id: 'sess-1' }],
    credentials_api3: [{ client_id: 'secret-client' }],
    group_ids: ['10', '999'],
    role_ids: ['1', '2'],
    access_filters: [{ model_name: 'secret', field: 'tenant', value: 'acme' }]
  };

  const sdk = buildMockLookerSdk({
    update_user: async (_id: string, _body: any, fields?: string) => {
      capturedFields.push({ op: 'update_user', fields });
      return sensitiveUser;
    },
    user: async (_id: string, fields?: string) => {
      capturedFields.push({ op: 'user', fields });
      return sensitiveUser;
    },
    update_user_credentials_email: async () => ({})
  });

  const ctx = makeContext(
    sdk,
    {
      profile: {
        allow_update_name: true,
        allow_update_email: true,
        allow_disable: true
      }
    },
    '100'
  );

  const updateRes = await handler(ctx, 'update_user_profile', {
    user_id: '200',
    first_name: 'Bobby'
  });
  assert.deepEqual(updateRes.user, { id: '200' });

  const emailOnlyUpdateRes = await handler(ctx, 'update_user_profile', {
    user_id: '200',
    email: 'bobby@example.com'
  });
  assert.deepEqual(emailOnlyUpdateRes.user, { id: '200' });

  const disableRes = await handler(ctx, 'set_user_disabled', {
    user_id: '200',
    is_disabled: true
  });
  assert.deepEqual(disableRes.user, { id: '200' });

  // Scope resolution calls sdk.user with 'id,group_ids' / 'id,role_ids,group_ids';
  // the action mutations/fetches themselves must request only 'id' (never undefined/unfiltered).
  assert.equal(
    capturedFields.filter((c) => !c.fields).length,
    0
  );
  assert.deepEqual(
    capturedFields.filter((c) => c.op === 'update_user' || c.fields === 'id'),
    [
      { op: 'update_user', fields: 'id' },
      { op: 'user', fields: 'id' },
      { op: 'update_user', fields: 'id' }
    ]
  );
});

test('user-management: list_users respects groups.allow_view and roles.allow_view and filters out external group_ids', async () => {
  const capturedAllRolesFields: Array<string | undefined> = [];
  let capturedAllUsersFields: string | undefined;

  const sdk = buildMockLookerSdk({
    all_users: async (params: any) => {
      capturedAllUsersFields = params?.fields;
      return [
        {
          id: '200',
          first_name: 'Bob',
          last_name: 'Builder',
          email: 'bob@example.com',
          is_disabled: false,
          group_ids: ['10', '999'],
          role_ids: ['5', '6']
        }
      ];
    },
    all_roles: async (params: any) => {
      capturedAllRolesFields.push(params?.fields);
      return [
        { id: '5', name: 'Developer' },
        { id: '6', name: 'Viewer' }
      ];
    }
  });

  // 1. Both groups.allow_view and roles.allow_view disabled
  const hiddenCtx = makeContext(
    sdk,
    {
      profile: { allow_create: false },
      groups: { allow_view: false },
      roles: { allow_view: false }
    },
    '100'
  );

  const hiddenRes = await handler(hiddenCtx, 'list_users', {});
  assert.equal(
    capturedAllRolesFields.filter((f) => f === 'id,name').length,
    0
  );
  assert.ok(capturedAllUsersFields && !capturedAllUsersFields.includes('role_ids'));
  assert.equal(hiddenRes.users.length, 1);
  assert.deepEqual(hiddenRes.users[0].group_ids, []);
  assert.deepEqual(hiddenRes.users[0].shared_scope_group_ids, []);
  assert.deepEqual(hiddenRes.users[0].manageable_groups, []);
  assert.deepEqual(hiddenRes.users[0].role_ids, []);
  assert.deepEqual(hiddenRes.users[0].direct_roles, []);
  assert.deepEqual(hiddenRes.scope_info.manageable_groups, []);
  assert.deepEqual(hiddenRes.scope_info.active_scope_groups, []);

  // 2. groups.allow_view enabled: external group '999' is still excluded from group_ids
  const groupViewCtx = makeContext(
    sdk,
    {
      groups: { allow_view: true },
      roles: { allow_view: false }
    },
    '100'
  );
  const groupViewRes = await handler(groupViewCtx, 'list_users', {});
  assert.deepEqual(groupViewRes.users[0].group_ids, ['10']);
  assert.deepEqual(groupViewRes.users[0].role_ids, []);
  assert.deepEqual(groupViewRes.users[0].direct_roles, []);
  assert.equal(groupViewRes.scope_info.manageable_groups[0]?.role_ids, undefined);
});
