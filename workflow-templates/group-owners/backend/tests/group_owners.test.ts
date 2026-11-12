import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../index';
import {
  parseGroupOwnerSpecifiers,
  formatGroupOwnerSpecifiers
} from '../../../../group_ownership';

function buildMockLookerSdk(overrides: Record<string, any> = {}) {
  const groupOwnerValues = new Map<string, string>([
    ['20', 'u:100,g:10'],
    ['30', 'u:999']
  ]);

  const groupUsers = new Map<string, string[]>([
    ['10', ['100']],
    ['20', ['100', '200']],
    ['21', ['200']],
    ['30', ['300']],
    ['40', []]
  ]);

  const defaultUsers: Record<string, any> = {
    '1': {
      id: '1',
      first_name: 'Super',
      last_name: 'Admin',
      display_name: 'Super Admin',
      email: 'admin@example.com',
      is_disabled: false,
      is_service_account: false,
      group_ids: ['10', '20'],
      role_ids: ['r_admin']
    },
    '2': {
      id: '2',
      first_name: 'Service',
      last_name: 'Bot',
      display_name: 'Service Bot',
      email: 'bot@example.com',
      is_disabled: false,
      is_service_account: true,
      group_ids: ['20'],
      role_ids: ['r_viewer']
    },
    '100': {
      id: '100',
      first_name: 'Alice',
      last_name: 'Owner',
      display_name: 'Alice Owner',
      email: 'alice@example.com',
      is_disabled: false,
      is_service_account: false,
      group_ids: ['10', '20'],
      role_ids: ['r_viewer']
    },
    '200': {
      id: '200',
      first_name: 'Bob',
      last_name: 'Member',
      display_name: 'Bob Member',
      email: 'bob@example.com',
      is_disabled: false,
      is_service_account: false,
      group_ids: ['20', '21'],
      role_ids: ['r_viewer']
    },
    '300': {
      id: '300',
      first_name: 'Charlie',
      last_name: 'Candidate',
      display_name: 'Charlie Candidate',
      email: 'charlie@example.com',
      is_disabled: false,
      is_service_account: false,
      group_ids: ['30'],
      role_ids: ['r_viewer']
    }
  };

  const defaultGroups: Record<string, any> = {
    '10': { id: '10', name: 'Marketing Managers', externally_managed: false },
    '20': { id: '20', name: 'Marketing Analysts', externally_managed: false },
    '21': { id: '21', name: 'Marketing Subteam', externally_managed: false },
    '30': { id: '30', name: 'Finance Analysts', externally_managed: false },
    '40': { id: '40', name: 'Available Subgroup', externally_managed: false }
  };

  const hierarchyParents = new Map<string, string[]>([
    ['10', []],
    ['20', []],
    ['21', ['20']],
    ['30', []],
    ['40', []]
  ]);

  const baseSdk: any = {
    ok: async (val: any) => await val,
    all_user_attributes: async () => [
      { id: 'attr_owners', name: 'nano_admin_group_owners', label: 'Group Owners', is_system: false, value_is_hidden: false },
      { id: 'attr_scope', name: 'nano_admin_is_workflow_scope_group', label: 'Scope Group', is_system: false, value_is_hidden: false }
    ],
    all_user_attribute_group_values: async (attrId: string) => {
      if (attrId === 'attr_owners') {
        return Array.from(groupOwnerValues.entries())
          .filter(([, val]) => Boolean(val))
          .map(([group_id, value]) => ({ group_id, value }));
      }
      if (attrId === 'attr_scope') {
        return [{ group_id: '10', value: 'yes' }];
      }
      return [];
    },
    update_user_attribute_group_values: async (attrId: string, body: Array<{ group_id: string; value: string }>) => {
      if (attrId === 'attr_owners') {
        groupOwnerValues.clear();
        for (const item of body) {
          groupOwnerValues.set(String(item.group_id), String(item.value));
        }
      }
      return body;
    },
    set_user_attribute_group_value: async (groupId: string, attrId: string, body: { value: string }) => {
      if (attrId === 'attr_owners') {
        groupOwnerValues.set(String(groupId), String(body?.value || ''));
      }
      return body;
    },
    delete_user_attribute_group_value: async (groupId: string, attrId: string) => {
      if (attrId === 'attr_owners') {
        groupOwnerValues.delete(String(groupId));
      }
      return '';
    },
    all_roles: async () => [
      {
        id: 'r_admin',
        name: 'Admin',
        permission_set: { id: 'ps_admin', name: 'Admin', all_access: true, permissions: ['administer'] }
      },
      {
        id: 'r_viewer',
        name: 'Viewer',
        permission_set: { id: 'ps_view', name: 'Viewer', all_access: false, permissions: ['access_data'] }
      }
    ],
    all_users: async () => Object.values(defaultUsers),
    user: async (id: string) => {
      const u = defaultUsers[String(id)];
      if (!u) throw new Error(`User ${id} not found`);
      return { ...u };
    },
    all_groups: async () => Object.values(defaultGroups),
    group: async (id: string) => {
      const g = defaultGroups[String(id)];
      if (!g) throw new Error(`Group ${id} not found`);
      return { ...g };
    },
    all_group_users: async (params: any) => {
      const gid = String(params.group_id);
      const memberIds = groupUsers.get(gid) || [];
      return memberIds.map((uid) => defaultUsers[uid]).filter(Boolean);
    },
    all_group_groups: async (groupId: string) => {
      const gid = String(groupId);
      const children: any[] = [];
      for (const [childId, parents] of hierarchyParents.entries()) {
        if (parents.includes(gid) && defaultGroups[childId]) {
          children.push(defaultGroups[childId]);
        }
      }
      return children;
    },
    search_groups_with_hierarchy: async () =>
      Object.values(defaultGroups).map((g: any) => ({
        id: g.id,
        name: g.name,
        externally_managed: g.externally_managed,
        parent_group_ids: hierarchyParents.get(g.id) || []
      })),
    add_group_user: async (groupId: string, body: { user_id: string }) => {
      const gid = String(groupId);
      const uid = String(body.user_id);
      const list = groupUsers.get(gid) || [];
      if (!list.includes(uid)) {
        list.push(uid);
        groupUsers.set(gid, list);
      }
      return defaultUsers[uid];
    },
    delete_group_user: async (groupId: string, userId: string) => {
      const gid = String(groupId);
      const uid = String(userId);
      const list = (groupUsers.get(gid) || []).filter((id) => id !== uid);
      groupUsers.set(gid, list);
      return '';
    },
    add_group_group: async (parentGroupId: string, body: { group_id: string }) => {
      const pid = String(parentGroupId);
      const cid = String(body.group_id);
      const parents = hierarchyParents.get(cid) || [];
      if (!parents.includes(pid)) {
        parents.push(pid);
        hierarchyParents.set(cid, parents);
      }
      return defaultGroups[cid];
    },
    delete_group_from_group: async (parentGroupId: string, childGroupId: string) => {
      const pid = String(parentGroupId);
      const cid = String(childGroupId);
      const parents = (hierarchyParents.get(cid) || []).filter((id) => id !== pid);
      hierarchyParents.set(cid, parents);
      return '';
    },
    create_group: async (body: { name: string }) => {
      const newId = '50';
      const newGroup = { id: newId, name: body.name, externally_managed: false };
      defaultGroups[newId] = newGroup;
      hierarchyParents.set(newId, []);
      groupUsers.set(newId, []);
      return newGroup;
    },
    ...overrides
  };

  return baseSdk;
}

function makeContext(sdk: any, parameters: any = {}, userId: string = '100') {
  return {
    sdk,
    userId,
    workflowId: 'test-go-wf',
    parameters,
    instanceHost: 'test.looker.app'
  };
}

test('group_ownership: strictly parses and formats canonical u:<id>,g:<id> specifiers', () => {
  const parsed = parseGroupOwnerSpecifiers(' u:10, g:20 , u:10 , user:99, 42, invalid, g:30 ');
  assert.deepEqual(parsed, [
    { type: 'user', id: '10' },
    { type: 'group', id: '20' },
    { type: 'group', id: '30' }
  ]);

  const formatted = formatGroupOwnerSpecifiers([
    { type: 'user', id: '10' },
    { type: 'user', id: '10' },
    { type: 'user', id: '5' },
    { type: 'group', id: '20' },
    { type: 'group', id: '30' }
  ]);
  assert.equal(formatted, 'u:10,u:5,g:20,g:30');
});

test('group-owners: list_owned_groups resolves direct and inherited subgroup ownership', async () => {
  const sdk = buildMockLookerSdk();

  // 1. Default include_subgroups: true returns directly owned group 20 (depth 0) with child group 21 (depth 1) nested inside subgroups
  const ctxWithSubgroups = makeContext(sdk, {}, '100');
  const resWithSub = await handler(ctxWithSubgroups, 'list_owned_groups', {});
  assert.equal(resWithSub.direct_owned_count, 1);
  assert.equal(resWithSub.total_manageable_count, 2);
  assert.equal(resWithSub.groups.length, 1);
  assert.equal(resWithSub.groups[0].id, '20');
  assert.equal(resWithSub.groups[0].subgroups.length, 1);
  assert.equal(resWithSub.groups[0].subgroups[0].id, '21');
  assert.equal(resWithSub.groups[0].subgroups[0].depth, 1);

  // 2. include_subgroups: false returns only directly owned group 20 with no subgroups
  const ctxDirectOnly = makeContext(sdk, { include_subgroups: false }, '100');
  const resDirect = await handler(ctxDirectOnly, 'list_owned_groups', {});
  assert.equal(resDirect.total_manageable_count, 1);
  assert.equal(resDirect.groups[0].subgroups.length, 0);
});

test('group-owners: get_group_details & user membership mutations enforce exclude_privileged by default', async () => {
  const sdk = buildMockLookerSdk();
  const ctx = makeContext(sdk, {}, '100');

  // 1. get_group_details succeeds for owned group '20' and excludes Super Admin ('1') & Service Bot ('2') from addable_users
  const detail = await handler(ctx, 'get_group_details', { group_id: '20' });
  assert.equal(detail.group.id, '20');
  assert.deepEqual(detail.addable_users.map((u: any) => u.id), ['300']);

  // 2. Adding Charlie ('300') succeeds
  const addOk = await handler(ctx, 'add_user_to_group', { group_id: '20', user_id: '300' });
  assert.equal(addOk.success, true);

  // 3. Adding Super Admin ('1') or Service Bot ('2') is rejected by exclude_privileged limitation
  await assert.rejects(
    async () => await handler(ctx, 'add_user_to_group', { group_id: '20', user_id: '1' }),
    /403 Forbidden: User "1" is outside the allowed user_id_limitation/i
  );
  await assert.rejects(
    async () => await handler(ctx, 'add_user_to_group', { group_id: '20', user_id: '2' }),
    /403 Forbidden: User "2" is outside the allowed user_id_limitation/i
  );

  // 4. Accessing unowned group '30' is rejected
  await assert.rejects(
    async () => await handler(ctx, 'get_group_details', { group_id: '30' }),
    /403 Forbidden: Group "30" is not in the invoking user's owned group hierarchy/i
  );
});

test('group-owners: update_group_owner adds/removes owners and blocks privileged user owners', async () => {
  const sdk = buildMockLookerSdk();
  const ctx = makeContext(sdk, {}, '100');

  // 1. Add user '300' as an owner of group '20'
  const addOwnerRes = await handler(ctx, 'update_group_owner', {
    group_id: '20',
    owner_type: 'user',
    owner_id: '300',
    operation: 'add'
  });
  assert.equal(addOwnerRes.raw_value, 'u:100,g:10,u:300');

  // 2. Adding Super Admin ('1') as owner is rejected by exclude_privileged
  await assert.rejects(
    async () =>
      await handler(ctx, 'update_group_owner', {
        group_id: '20',
        owner_type: 'user',
        owner_id: '1',
        operation: 'add'
      }),
    /403 Forbidden: User "1" is outside the allowed user_id_limitation/i
  );

  // 3. Removing owner '300' succeeds
  const remOwnerRes = await handler(ctx, 'update_group_owner', {
    group_id: '20',
    owner_type: 'user',
    owner_id: '300',
    operation: 'remove'
  });
  assert.equal(remOwnerRes.raw_value, 'u:100,g:10');
});

test('group-owners: child subgroup mutations enforce hierarchy cycle detection and capability flags', async () => {
  const sdk = buildMockLookerSdk();
  const ctx = makeContext(
    sdk,
    {
      memberships: {
        allow_add_existing_groups: true,
        allow_remove_child_groups: true,
        allow_create_subgroups: true
      }
    },
    '100'
  );

  // 1. Adding group '20' as a child of its own child '21' is blocked (cycle detection)
  await assert.rejects(
    async () => await handler(ctx, 'add_child_group', { parent_group_id: '21', child_group_id: '20' }),
    /400 Bad Request: Cannot add an ancestor group as a child subgroup \(cycle detected\)/i
  );

  // 2. Adding available group '40' as a child of '20' succeeds
  const addChildRes = await handler(ctx, 'add_child_group', { parent_group_id: '20', child_group_id: '40' });
  assert.equal(addChildRes.success, true);

  // 3. Creating a new child group under '20' creates group '50' and attaches it
  const createChildRes = await handler(ctx, 'create_child_group', {
    parent_group_id: '20',
    group_name: 'Marketing Regional Subgroup'
  });
  assert.equal(createChildRes.success, true);
  assert.equal(createChildRes.group.id, '50');
});
