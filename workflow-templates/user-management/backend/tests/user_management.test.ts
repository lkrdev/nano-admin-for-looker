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
